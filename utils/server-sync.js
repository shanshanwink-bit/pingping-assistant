const config = require('./server-config')

let currentRevision = 0
let pendingState = null
let syncTimer = null
let pushInFlight = false
let lastSyncAt = ''
let lastSyncError = null
const syncListeners = []

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isDevelopmentEnvironment() {
  try {
    return typeof wx.getAccountInfoSync === 'function' &&
      wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
  } catch (error) {
    return false
  }
}

function safeDevelopmentOverride(value) {
  const url = String(value || '').trim().replace(/\/$/, '')
  if (!url || !isDevelopmentEnvironment()) return ''
  if (/^https:\/\/[^/]+(?:\/.*)?$/.test(url)) return url
  if (/^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/.*)?$/.test(url)) return url
  return ''
}

function apiBaseUrl() {
  const storedOverride = wx.getStorageSync(config.apiOverrideStorageKey)
  const override = safeDevelopmentOverride(storedOverride)
  if (storedOverride && !override) wx.removeStorageSync(config.apiOverrideStorageKey)
  return String(override || config.apiBaseUrl || '').replace(/\/$/, '')
}

function initServer() {
  const baseUrl = apiBaseUrl()
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('自有服务器 API 地址未配置')
  return Promise.resolve({ baseUrl })
}

function session() {
  return wx.getStorageSync(config.sessionKey) || null
}

function getSyncStatus() {
  let state = 'connected'
  if (lastSyncError) state = 'failed'
  else if (pendingState || pushInFlight) state = 'pending'
  else if (lastSyncAt) state = 'synced'
  return {
    state,
    lastSyncAt,
    errorMessage: lastSyncError ? lastSyncError.message || String(lastSyncError) : '',
    hasPending: Boolean(pendingState || pushInFlight)
  }
}

function notifySyncStatus() {
  const status = getSyncStatus()
  syncListeners.slice().forEach(listener => listener(status))
}

function subscribeSyncStatus(listener) {
  if (typeof listener !== 'function') return () => {}
  syncListeners.push(listener)
  listener(getSyncStatus())
  return () => {
    const index = syncListeners.indexOf(listener)
    if (index >= 0) syncListeners.splice(index, 1)
  }
}

function markSyncSuccess() {
  lastSyncAt = new Date().toISOString()
  lastSyncError = null
  notifySyncStatus()
}

function markSyncFailure(error) {
  lastSyncError = error || new Error('数据同步失败')
  notifySyncStatus()
}

function request(options) {
  const settings = options || {}
  const activeSession = session()
  const headers = { 'Content-Type': 'application/json', ...(settings.header || {}) }
  if (activeSession && activeSession.token) headers.Authorization = `Bearer ${activeSession.token}`

  return initServer().then(({ baseUrl }) => new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${settings.path}`,
      method: settings.method || 'GET',
      data: settings.data,
      header: headers,
      timeout: config.requestTimeout,
      success(response) {
        const result = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300 && result.ok !== false) {
          resolve(result)
          return
        }
        const error = new Error(result.message || `服务器请求失败（${response.statusCode}）`)
        error.statusCode = response.statusCode
        error.details = result.details
        error.requestId = result.requestId
        reject(error)
      },
      fail(error) {
        reject(new Error(error.errMsg || '无法连接自有服务器，请检查网络和 API 地址'))
      }
    })
  }))
}

function wechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) resolve(result.code)
        else reject(new Error('微信未返回登录凭证，请重试'))
      },
      fail(error) {
        reject(new Error(error.errMsg || '微信登录凭证获取失败'))
      }
    })
  })
}

async function wechatLogin(profile) {
  const code = await wechatCode()
  const result = await request({
    path: '/auth/wechat/login',
    method: 'POST',
    data: { code, profile: profile || {} }
  })
  if (!result.token || !result.user || !result.user.openid) throw new Error('服务器登录响应不完整')
  return result
}

async function pullState() {
  try {
    const result = await request({ path: '/store/state' })
    currentRevision = Number(result.revision || 0)
    markSyncSuccess()
    return {
      exists: Boolean(result.exists),
      state: result.state || null,
      revision: currentRevision,
      updatedAt: result.updatedAt || ''
    }
  } catch (error) {
    markSyncFailure(error)
    throw error
  }
}

async function pullProducts() {
  const result = await request({ path: '/catalog/products' })
  return { items: Array.isArray(result.items) ? result.items : [] }
}

async function updateProductProfile(adminProductId, input) {
  const id = Number(adminProductId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('后台商品关联不正确')
  const result = await request({
    path: `/catalog/products/${id}`,
    method: 'PATCH',
    data: clone(input)
  })
  return result.item || null
}

async function pullFeatures() {
  const result = await request({ path: '/features' })
  return { aiImageRecognition: result.aiImageRecognition === true }
}

function uploadAiImage(path, filePath, responseErrorText, uploadErrorText) {
  const activeSession = session()
  if (!activeSession || !activeSession.token) return Promise.reject(new Error('请先登录'))
  return initServer().then(({ baseUrl }) => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}${path}`,
      filePath,
      name: 'image',
      header: { Authorization: `Bearer ${activeSession.token}` },
      timeout: config.aiRequestTimeout,
      success(response) {
        let result = {}
        try { result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data || {} } catch (error) {}
        if (response.statusCode >= 200 && response.statusCode < 300 && result.ok !== false) {
          resolve(result)
          return
        }
        const requestError = new Error(result.message || `${responseErrorText}（${response.statusCode}）`)
        requestError.statusCode = response.statusCode
        requestError.details = result.details
        requestError.requestId = result.requestId
        reject(requestError)
      },
      fail(error) {
        reject(new Error(error.errMsg || uploadErrorText))
      }
    })
  }))
}

function recognizeProductImage(filePath) {
  return uploadAiImage(
    '/ai/image-recognition',
    filePath,
    '图片识别失败',
    '图片上传失败，请检查网络后重试'
  )
}

function recognizePurchaseOrderImage(filePath) {
  return uploadAiImage(
    '/ai/purchase-order-recognition',
    filePath,
    '采购单识别失败',
    '采购单图片上传失败，请检查网络后重试'
  )
}

async function pushState(state) {
  try {
    const result = await request({
      path: '/store/state',
      method: 'PUT',
      data: { state: clone(state), revision: currentRevision }
    })
    currentRevision = Number(result.revision || currentRevision + 1)
    markSyncSuccess()
    return result
  } catch (error) {
    markSyncFailure(error)
    throw error
  }
}

async function commitSale(payload) {
  const result = await request({ path: '/store/sales', method: 'POST', data: clone(payload) })
  currentRevision = Number(result.revision || currentRevision)
  clearPendingPush()
  markSyncSuccess()
  return result
}

async function commitPurchase(payload) {
  const result = await request({ path: '/store/purchases', method: 'POST', data: clone(payload) })
  currentRevision = Number(result.revision || currentRevision)
  clearPendingPush()
  markSyncSuccess()
  return result
}

async function commitPurchaseBatch(payload) {
  const result = await request({ path: '/store/purchases/batch', method: 'POST', data: clone(payload) })
  currentRevision = Number(result.revision || currentRevision)
  clearPendingPush()
  markSyncSuccess()
  return result
}

function clearPendingPush() {
  pendingState = null
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = null
  notifySyncStatus()
}

function hasServerSession() {
  const activeSession = session()
  return Boolean(activeSession && activeSession.openid && activeSession.token)
}

function scheduleFlush(delay) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(flushQueue, delay)
}

function flushQueue() {
  syncTimer = null
  if (pushInFlight || !pendingState || !hasServerSession()) return Promise.resolve(false)
  const target = pendingState
  pendingState = null
  pushInFlight = true
  notifySyncStatus()
  return pushState(target).then(() => true).catch(error => {
    pendingState = target
    console.warn('萍萍小助手服务器同步失败：', error.message || error)
    notifySyncStatus()
    return false
  }).finally(() => {
    pushInFlight = false
    notifySyncStatus()
    if (pendingState) scheduleFlush(1000)
  })
}

function queuePush(state) {
  if (!hasServerSession()) return
  pendingState = clone(state)
  lastSyncError = null
  notifySyncStatus()
  scheduleFlush(500)
}

function retryPendingPush() {
  if (!pendingState || !hasServerSession()) return Promise.resolve(false)
  lastSyncError = null
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = null
  notifySyncStatus()
  return flushQueue()
}

function resetSyncState() {
  currentRevision = 0
  clearPendingPush()
  pushInFlight = false
  lastSyncAt = ''
  lastSyncError = null
  notifySyncStatus()
}

module.exports = {
  initServer,
  wechatLogin,
  pullState,
  pullProducts,
  updateProductProfile,
  pullFeatures,
  recognizeProductImage,
  recognizePurchaseOrderImage,
  pushState,
  commitSale,
  commitPurchase,
  commitPurchaseBatch,
  queuePush,
  retryPendingPush,
  getSyncStatus,
  subscribeSyncStatus,
  resetSyncState,
  apiBaseUrl
}
