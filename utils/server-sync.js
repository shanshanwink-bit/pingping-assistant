const config = require('./server-config')

let currentRevision = 0
let pendingState = null
let syncTimer = null
let pushInFlight = false

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function apiBaseUrl() {
  const override = wx.getStorageSync(config.apiOverrideStorageKey)
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
  const result = await request({ path: '/store/state' })
  currentRevision = Number(result.revision || 0)
  return {
    exists: Boolean(result.exists),
    state: result.state || null,
    revision: currentRevision,
    updatedAt: result.updatedAt || ''
  }
}

async function pushState(state) {
  const result = await request({
    path: '/store/state',
    method: 'PUT',
    data: { state: clone(state), revision: currentRevision }
  })
  currentRevision = Number(result.revision || currentRevision + 1)
  return result
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
  if (pushInFlight || !pendingState || !hasServerSession()) return
  const target = pendingState
  pendingState = null
  pushInFlight = true
  pushState(target).catch(error => {
    pendingState = target
    console.warn('萍萍小助手服务器同步失败：', error.message || error)
  }).finally(() => {
    pushInFlight = false
    if (pendingState) scheduleFlush(1000)
  })
}

function queuePush(state) {
  if (!hasServerSession()) return
  pendingState = clone(state)
  scheduleFlush(500)
}

function resetSyncState() {
  currentRevision = 0
  pendingState = null
  pushInFlight = false
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = null
}

module.exports = {
  initServer,
  wechatLogin,
  pullState,
  pushState,
  queuePush,
  resetSyncState,
  apiBaseUrl
}
