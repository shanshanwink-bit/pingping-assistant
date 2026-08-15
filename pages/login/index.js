const auth = require('../../utils/auth')
const cloudSync = require('../../utils/cloud-sync')
const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    ownerName: '微信店主',
    avatarUrl: '',
    submitting: false,
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
    Promise.resolve().then(() => cloudSync.initCloud()).catch(error => {
      this.setData({ errorText: error.message || '云开发初始化失败' })
    })
    const user = auth.getCurrentUser()
    if (user) {
      this.setData({ ownerName: user.name, avatarUrl: user.avatarUrl, restoring: true })
      this.syncAndEnter(user).catch(error => {
        this.setData({
          restoring: false,
          offlineAvailable: true,
          errorText: `云端同步失败：${error.message || '请检查网络和云环境'}`
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
    const remote = await cloudSync.pullState()
    if (remote.exists && remote.state) {
      store.replaceStateFromCloud(remote.state, user)
    } else {
      store.setCurrentUser(user)
      await cloudSync.pushState(store.getState())
    }
    this.setData({ submitting: false, restoring: false, offlineAvailable: false })
    wx.switchTab({ url: '/pages/home/index' })
  },

  async submitWechatLogin() {
    if (this.data.submitting || this.data.restoring) return
    this.setData({ submitting: true, errorText: '', offlineAvailable: false })
    try {
      const user = await auth.loginWithWechat({
        name: this.data.ownerName,
        avatarUrl: this.data.avatarUrl
      })
      await this.syncAndEnter(user)
      wx.showToast({ title: '微信登录成功', icon: 'success' })
    } catch (error) {
      const hasSession = Boolean(auth.getCurrentUser())
      this.setData({
        submitting: false,
        offlineAvailable: hasSession,
        errorText: error.message || '微信登录失败，请重试'
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
        errorText: `云端同步失败：${error.message || '请稍后重试'}`
      })
    })
  },

  enterOffline() {
    const user = auth.getCurrentUser()
    if (!user) return
    store.setCurrentUser(user)
    wx.switchTab({ url: '/pages/home/index' })
  }
})
