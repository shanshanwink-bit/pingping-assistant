const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ALLOWED_APP_IDS = [
  'wx_resource_appid_here',
  'wx_current_appid_here'
]

exports.main = async () => {
  const context = cloud.getWXContext()
  const sourceAppId = context.FROM_APPID || context.APPID

  if (!ALLOWED_APP_IDS.includes(sourceAppId)) {
    return {
      errCode: -1,
      errMsg: '该小程序无权访问共享云环境',
      auth: JSON.stringify({ allowed: false })
    }
  }

  return {
    errCode: 0,
    errMsg: '',
    auth: JSON.stringify({
      allowed: true,
      sourceAppId
    })
  }
}
