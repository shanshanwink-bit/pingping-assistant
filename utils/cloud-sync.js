const config = require('./cloud-config')

let cloudClient = null
let initialization = null
let pendingState = null
let syncTimer = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function initCloud() {
  if (initialization) return initialization
  if (!wx.cloud) throw new Error('当前基础库不支持云开发，请升级微信开发者工具')
  const accountInfo = typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync() : null
  const runtimeAppId = accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.appId
  if (config.appId && runtimeAppId && runtimeAppId !== config.appId) {
    throw new Error(`当前 AppID ${runtimeAppId} 与项目配置 ${config.appId} 不一致`)
  }

  const shared = config.sharedEnvironment
  if (shared && shared.resourceAppid && shared.resourceEnv) {
    if (typeof wx.cloud.Cloud !== 'function') {
      throw new Error('当前基础库不支持云环境共享，请升级微信开发者工具和基础库')
    }
    cloudClient = new wx.cloud.Cloud({
      resourceAppid: shared.resourceAppid,
      resourceEnv: shared.resourceEnv
    })
    initialization = Promise.resolve(cloudClient.init()).then(() => cloudClient)
    return initialization
  }

  const options = { traceUser: true }
  if (config.envId) options.env = config.envId
  wx.cloud.init(options)
  cloudClient = wx.cloud
  initialization = Promise.resolve(cloudClient)
  return initialization
}

async function callFunction(name, data) {
  const client = await initCloud()
  return client.callFunction({ name, data: data || {} }).then(response => response.result || {})
}

async function wechatLogin() {
  const result = await callFunction(config.loginFunction)
  if (!result.openid) {
    throw new Error(result.message || '登录云函数未返回 OpenID，请在共享环境重新部署 login 云函数')
  }
  return result
}

async function pullState() {
  const result = await callFunction(config.storeSyncFunction, { action: 'pull' })
  if (result.ok === false) throw new Error(result.message || '云端库存读取失败')
  return {
    exists: Boolean(result.exists),
    state: result.state || null,
    updatedAt: result.updatedAt || ''
  }
}

async function pushState(state) {
  const result = await callFunction(config.storeSyncFunction, { action: 'push', state: clone(state) })
  if (result.ok === false) throw new Error(result.message || '云端库存保存失败')
  return result
}

function hasWechatSession() {
  const session = wx.getStorageSync(config.sessionKey)
  return Boolean(session && session.openid)
}

function queuePush(state) {
  if (!hasWechatSession() || !wx.cloud) return
  pendingState = clone(state)
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    const target = pendingState
    pendingState = null
    syncTimer = null
    pushState(target).catch(error => {
      console.warn('萍萍小助手云同步失败：', error.message || error)
    })
  }, 500)
}

module.exports = {
  initCloud,
  wechatLogin,
  pullState,
  pushState,
  queuePush
}
