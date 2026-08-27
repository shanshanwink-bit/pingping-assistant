const config = require('./server-config')
const serverSync = require('./server-sync')

function getCurrentUser() {
  const session = wx.getStorageSync(config.sessionKey)
  const isDemo = Boolean(session && session.demo === true)
  if (!session || !session.token || (!session.openid && !(isDemo && session.id))) return null
  return {
    id: session.id || session.openid,
    openid: session.openid || '',
    account: isDemo ? '体验账号' : session.account || session.openid || '',
    name: isDemo ? '体验账号' : session.name || '用户',
    avatarUrl: session.avatarUrl || '',
    role: session.role || '',
    storeId: session.storeId || '',
    storeName: isDemo ? '萍萍体验店' : session.storeName || '',
    loggedInAt: session.loggedInAt || '',
    demo: isDemo
  }
}

function canEditProducts() {
  return getCurrentUser()?.role === 'owner'
}

async function loginWithWechat(profile) {
  const identity = await serverSync.wechatLogin(profile)
  const remoteUser = identity.user
  const session = {
    token: identity.token,
    id: remoteUser.id || remoteUser.openid,
    openid: remoteUser.openid,
    account: remoteUser.openid,
    unionid: remoteUser.unionid || '',
    name: remoteUser.name || String(profile && profile.name || '').trim() || '用户',
    avatarUrl: remoteUser.avatarUrl || profile && profile.avatarUrl || '',
    role: remoteUser.role || '',
    storeId: remoteUser.storeId || '',
    storeName: remoteUser.storeName || '',
    loggedInAt: new Date().toISOString(),
    demo: false
  }
  wx.setStorageSync(config.sessionKey, session)
  return getCurrentUser()
}

async function loginDemo() {
  const identity = await serverSync.demoLogin()
  const remoteUser = identity.user
  const session = {
    token: identity.token,
    id: remoteUser.id,
    openid: '',
    account: '体验账号',
    name: remoteUser.name || '体验账号',
    avatarUrl: remoteUser.avatarUrl || '',
    role: remoteUser.role || 'clerk',
    storeId: remoteUser.storeId || '',
    storeName: remoteUser.storeName || '',
    loggedInAt: new Date().toISOString(),
    demo: true
  }
  wx.setStorageSync(config.sessionKey, session)
  return getCurrentUser()
}

function logout() {
  wx.removeStorageSync(config.sessionKey)
  serverSync.resetSyncState()
}

module.exports = {
  canEditProducts,
  getCurrentUser,
  loginDemo,
  loginWithWechat,
  logout
}
