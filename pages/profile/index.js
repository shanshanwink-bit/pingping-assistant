const store = require('../../utils/store')
const auth = require('../../utils/auth')

Page({
  data: { user: null, avatarText: '店', accountDisplay: '', productCount: 0, totalStock: 0 },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 4 })
    const user = auth.getCurrentUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    const summary = store.getSummary()
    this.setData({
      user,
      avatarText: String(user.name || '店').slice(0, 1),
      accountDisplay: user.openid ? `${user.openid.slice(0, 6)}••••${user.openid.slice(-4)}` : '微信账号',
      productCount: summary.productCount,
      totalStock: summary.totalStock
    })
  },

  showAccountSecurity() {
    wx.showModal({
      title: '账号与安全',
      content: `微信身份：${this.data.accountDisplay}\n身份：店主管理员\n\n商品、库存、销售和盈利数据会同步到该微信账号的云端店铺。`,
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  logoutAccount() {
    wx.showModal({
      title: '退出当前账号？',
      content: '退出后需要重新使用微信账号登录。云端商品、库存、销售和盈利数据不会被删除。',
      confirmText: '退出登录',
      confirmColor: '#d36e94',
      success: result => {
        if (!result.confirm) return
        auth.logout()
        wx.reLaunch({ url: '/pages/login/index' })
      }
    })
  },

  showComingSoon(event) {
    wx.showModal({
      title: event.currentTarget.dataset.title,
      content: '这个入口已保留，将在云端多人版本中完善。当前版本先保证库存流程稳定可用。',
      showCancel: false
    })
  },

  exportData() {
    const state = store.getState()
    const rows = ['商品编号,货号,商品名称,分类,颜色,尺码,库存,进价,参考售价,供应商']
    state.products.forEach(product => {
      product.specs.forEach(spec => {
        const values = [product.code, product.itemNumber || '', product.name, product.category, spec.color, spec.size, spec.stock, product.costPrice, product.salePrice || 0, product.supplier]
        rows.push(values.map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(','))
      })
    })
    wx.setClipboardData({
      data: rows.join('\n'),
      success: () => wx.showToast({ title: '库存表已复制', icon: 'success' })
    })
  },

  showAbout() {
    wx.showModal({
      title: '萍萍小助手 v0.3',
      content: '当前支持微信 OpenID 登录与云数据库同步，每个微信账号拥有独立的店铺经营数据。',
      showCancel: false
    })
  }
})
