const config = require('./server-config')
const serverSync = require('./server-sync')

function getCurrentUser() {
  const session = wx.getStorageSync(config.sessionKey)
  if (!session || !session.openid) return null
  return {
    id: session.openid,
    openid: session.openid,
    account: session.openid,
    name: session.name || '微信店主',
    avatarUrl: session.avatarUrl || '',
    role: session.role || 'owner',
    storeId: session.storeId || '',
    storeName: session.storeName || '',
    loggedInAt: session.loggedInAt || ''
  }
}

async function loginWithWechat(profile) {
  const identity = await serverSync.wechatLogin(profile)
  const remoteUser = identity.user
  const session = {
    token: identity.token,
    openid: remoteUser.openid,
    unionid: remoteUser.unionid || '',
    name: remoteUser.name || String(profile && profile.name || '').trim() || '微信店主',
    avatarUrl: remoteUser.avatarUrl || profile && profile.avatarUrl || '',
    role: remoteUser.role || 'owner',
    storeId: remoteUser.storeId || '',
    storeName: remoteUser.storeName || '',
    loggedInAt: new Date().toISOString()
  }
  wx.setStorageSync(config.sessionKey, session)
  return getCurrentUser()
}

function logout() {
  wx.removeStorageSync(config.sessionKey)
  serverSync.resetSyncState()
}

module.exports = {
  getCurrentUser,
  loginWithWechat,
  logout
}
