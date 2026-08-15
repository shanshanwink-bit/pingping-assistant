module.exports = {
  // 发布前替换为自己的小程序 AppID；留空时不校验运行时 AppID。
  appId: '',
  // 如使用同主体云环境共享，请填写资源方 AppID 与云环境 ID。
  sharedEnvironment: {
    resourceAppid: '',
    resourceEnv: ''
  },
  envId: '',
  loginFunction: 'login',
  storeSyncFunction: 'store-sync',
  storeCollection: 'store_states',
  sessionKey: 'shuishui_wechat_session_v1'
}
