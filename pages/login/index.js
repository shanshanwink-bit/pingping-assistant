const auth = require('../../utils/auth')
const serverSync = require('../../utils/server-sync')
const store = require('../../utils/store')
const catalogSync = require('../../utils/catalog-sync')

Page({
  data: {
    statusBarHeight: 20,
    ownerName: '微信店主',
    avatarUrl: '',
    submitting: false,
    demoSubmitting: false,
    restoring: false,
    offlineAvailable: false,
    errorText: ''
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ statusBarHeight: Number(info.statusBarHeight || 20) })
    } catch (error) {
      console.warn('读取窗口信息失败：', error.message || error)
    }
    Promise.resolve().then(() => serverSync.initServer()).catch(error => {
      this.setData({ errorText: error.message || '自有服务器地址配置不正确' })
    })
    const user = auth.getCurrentUser()
    if (user) {
      this.setData({ ownerName: user.name, avatarUrl: user.avatarUrl, restoring: true })
      this.syncAndEnter(user).catch(error => {
        if (user.demo) auth.logout()
        this.setData({
          restoring: false,
          offlineAvailable: this.canUseOffline(user),
          errorText: `服务器同步失败：${error.message || '请检查网络和 API 配置'}`
        })
      })
    }
  },

  inputName(event) {
    this.setData({ ownerName: event.detail.value, errorText: '' })
  },

  chooseAvatar(event) {
    this.setData({ avatarUrl: event.detail.avatarUrl || '' })
  },

  async syncAndEnter(user) {
    const remote = await serverSync.pullState()
    if (remote.exists && remote.state) {
      store.replaceStateFromServer(remote.state, user)
    } else {
      if (user.demo) throw new Error('体验店尚未初始化，请联系维护人员')
      if (!store.canInitializeStoreFromCache(user.storeId)) {
        throw new Error('本机缓存属于其他店铺，不能用于初始化当前店铺')
      }
      store.setCurrentUser(user)
      await serverSync.pushState(store.getState())
    }
    await catalogSync.refreshProducts()
    this.setData({ submitting: false, demoSubmitting: false, restoring: false, offlineAvailable: false })
    wx.switchTab({ url: '/pages/home/index' })
  },

  canUseOffline(user) {
    return Boolean(user && !user.demo && store.isStateForStore(user.storeId))
  },

  async submitWechatLogin() {
    if (this.data.submitting || this.data.demoSubmitting || this.data.restoring) return
    this.setData({ submitting: true, errorText: '', offlineAvailable: false })
    try {
      const user = await auth.loginWithWechat({
        name: this.data.ownerName,
        avatarUrl: this.data.avatarUrl
      })
      await this.syncAndEnter(user)
      wx.showToast({ title: '微信登录成功', icon: 'success' })
    } catch (error) {
      const currentUser = auth.getCurrentUser()
      this.setData({
        submitting: false,
        offlineAvailable: this.canUseOffline(currentUser),
        errorText: error.message || '微信登录失败，请重试'
      })
    }
  },

  async submitDemoLogin() {
    if (this.data.submitting || this.data.demoSubmitting || this.data.restoring) return
    this.setData({ demoSubmitting: true, errorText: '', offlineAvailable: false })
    try {
      const user = await auth.loginDemo()
      await this.syncAndEnter(user)
      wx.showToast({ title: '已进入萍萍体验店', icon: 'success' })
    } catch (error) {
      if (auth.getCurrentUser()?.demo) auth.logout()
      this.setData({
        demoSubmitting: false,
        offlineAvailable: false,
        errorText: error.message || '体验模式暂不可用'
      })
    }
  },

  retrySync() {
    const user = auth.getCurrentUser()
    if (!user) {
      this.submitWechatLogin()
      return
    }
    this.setData({ restoring: true, errorText: '', offlineAvailable: false })
    this.syncAndEnter(user).catch(error => {
      this.setData({
        restoring: false,
        offlineAvailable: true,
        errorText: `服务器同步失败：${error.message || '请稍后重试'}`
      })
    })
  },

  enterOffline() {
    const user = auth.getCurrentUser()
    if (!this.canUseOffline(user)) return
    store.setCurrentUser(user)
    wx.switchTab({ url: '/pages/home/index' })
  }
})
