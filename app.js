const store = require('./utils/store')
const auth = require('./utils/auth')
const serverSync = require('./utils/server-sync')

App({
  onLaunch() {
    store.ensureState()
    Promise.resolve().then(() => serverSync.initServer()).catch(error => {
      console.warn('自有服务器初始化失败：', error.message || error)
    })
  },
  onShow() {
    setTimeout(() => {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.route !== 'pages/login/index' && !auth.getCurrentUser()) {
        wx.reLaunch({ url: '/pages/login/index' })
      }
    }, 0)
  },
  globalData: {
    appName: '萍萍小助手'
  }
})
