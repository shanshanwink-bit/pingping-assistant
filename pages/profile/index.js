const auth = require('../../utils/auth')
const serverSync = require('../../utils/server-sync')
const profile = require('../../utils/profile')

Page({
  data: {
    userReady: false,
    userView: profile.buildUserView(null),
    syncView: profile.buildSyncView(serverSync.getSyncStatus()),
    version: profile.APP_VERSION,
    syncing: false
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 3 })
    const user = auth.getCurrentUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    this.setData({ userReady: true, userView: profile.buildUserView(user) })
    this.startSyncObserver()
  },

  onHide() {
    this.stopSyncObserver()
  },

  onUnload() {
    this.stopSyncObserver()
  },

  startSyncObserver() {
    this.stopSyncObserver()
    this.unsubscribeSync = serverSync.subscribeSyncStatus(status => {
      this.setData({ syncView: profile.buildSyncView(status) })
    })
  },

  stopSyncObserver() {
    if (typeof this.unsubscribeSync === 'function') this.unsubscribeSync()
    this.unsubscribeSync = null
  },

  openOperations() {
    wx.navigateTo({ url: '/pages/operations/index?source=profile' })
  },

  async retrySync() {
    if (this.data.syncing) return
    this.setData({ syncing: true })
    const synced = await serverSync.retryPendingPush()
    this.setData({ syncing: false })
    wx.showToast({
      title: synced ? '同步完成' : '暂无待同步数据',
      icon: synced ? 'success' : 'none'
    })
  },

  showAdminConsole() {
    wx.showModal({
      title: '管理后台',
      content: '用于商品维护和系统管理。微信小程序暂不直接打开外部网页，请在电脑浏览器中使用。当前为部署联调地址，正式域名将在备案完成后更新。',
      cancelText: '取消',
      confirmText: '复制地址',
      success: result => {
        if (!result.confirm) return
        wx.setClipboardData({ data: profile.ADMIN_CONSOLE_URL })
      }
    })
  },

  logoutAccount() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      confirmText: '退出登录',
      confirmColor: '#8E3655',
      success: result => {
        if (!profile.shouldConfirmLogout(result)) return
        this.stopSyncObserver()
        auth.logout()
        wx.reLaunch({ url: '/pages/login/index' })
      }
    })
  },

  showAbout() {
    wx.showModal({
      title: '关于萍萍小助手',
      content: '萍萍小助手\n\n面向小型服装、美妆零售场景的轻量经营管理工具。\n\n主要功能：商品、库存、卖货、拿货、账本。',
      showCancel: false
    })
  }
})
