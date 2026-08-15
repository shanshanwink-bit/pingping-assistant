const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const context = cloud.getWXContext()
  const sourceAppId = context.FROM_APPID || context.APPID
  const sourceOpenId = context.FROM_OPENID || context.OPENID
  return {
    openid: sourceOpenId,
    appid: sourceAppId,
    unionid: context.FROM_UNIONID || context.UNIONID || ''
  }
}
