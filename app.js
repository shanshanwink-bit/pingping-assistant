const store = require('./utils/store')
const auth = require('./utils/auth')
const cloudSync = require('./utils/cloud-sync')

App({
  onLaunch() {
    store.ensureState()
    Promise.resolve().then(() => cloudSync.initCloud()).catch(error => {
      console.warn('云开发初始化失败：', error.message || error)
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
