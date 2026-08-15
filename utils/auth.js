const config = require('./cloud-config')
const cloudSync = require('./cloud-sync')

function getCurrentUser() {
  const session = wx.getStorageSync(config.sessionKey)
  if (!session || !session.openid) return null
  return {
    id: session.openid,
    openid: session.openid,
    account: session.openid,
    name: session.name || '微信店主',
    avatarUrl: session.avatarUrl || '',
    role: 'owner',
    loggedInAt: session.loggedInAt || ''
  }
}

async function loginWithWechat(profile) {
  const identity = await cloudSync.wechatLogin()
  const session = {
    openid: identity.openid,
    appid: identity.appid || '',
    unionid: identity.unionid || '',
    name: String(profile && profile.name || '').trim() || '微信店主',
    avatarUrl: profile && profile.avatarUrl || '',
    loggedInAt: new Date().toISOString()
  }
  wx.setStorageSync(config.sessionKey, session)
  return getCurrentUser()
}

function logout() {
  wx.removeStorageSync(config.sessionKey)
}

module.exports = {
  getCurrentUser,
  loginWithWechat,
  logout
}
