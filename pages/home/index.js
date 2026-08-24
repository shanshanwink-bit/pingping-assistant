const auth = require('../../utils/auth')
const catalogSync = require('../../utils/catalog-sync')
const homeDashboard = require('../../utils/home-dashboard')
const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navSpacerHeight: 64,
    isLoading: true,
    isSyncing: false,
    loadFailed: false,
    syncError: false,
    greetingLine: homeDashboard.greetingForHour(new Date().getHours()),
    businessGreetingTitle: '今天还没有经营记录哦',
    businessGreetingDetail: '记下一笔，让每一次经营都有迹可循',
    todaySaleAmountText: '¥0.00',
    todayProfitText: '¥0.00',
    todaySaleQuantityText: '0',
    hasTodaySales: false,
    salesAmountClass: '',
    productCountText: '0',
    totalStockText: '0',
    stockValueText: '¥0.00',
    attentionItems: [],
    recentRecords: [],
    hasStockAlerts: false,
    stockAlertProductCountText: '0',
    hasExpiryAlerts: false
  },

  onLoad() {
    this.setupNavigationBar()
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 0 })
    this.loadDashboard(true)
  },

  setupNavigationBar() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = Number(windowInfo.statusBarHeight || 20)
      const navBarHeight = menuRect && menuRect.top
        ? (menuRect.top - statusBarHeight) * 2 + menuRect.height
        : 44
      this.setData({
        statusBarHeight,
        navBarHeight,
        navSpacerHeight: statusBarHeight + navBarHeight
      })
    } catch (error) {
      console.warn('读取导航栏尺寸失败：', error.message || error)
    }
  },

  loadDashboard(refreshCatalog) {
    try {
      const state = store.getState()
      const summary = store.getSummary()
      const todayProfit = ['clothing', 'cosmetics'].reduce((total, businessType) => (
        total + Number(store.getProfitAnalysis({ businessType, period: 'today' }).summary.profit || 0)
      ), 0)
      const user = auth.getCurrentUser() || state.currentUser || null
      const dashboard = homeDashboard.buildHomeDashboard({ state, summary, todayProfit, user })
      this.setData({ ...dashboard, isLoading: false, loadFailed: false })
    } catch (error) {
      console.error('首页经营数据加载失败：', error)
      this.setData({ isLoading: false, loadFailed: true })
      return
    }

    if (refreshCatalog) this.refreshCatalog()
  },

  refreshCatalog() {
    if (this._refreshing) return
    this._refreshing = true
    this.setData({ isSyncing: true, syncError: false })
    catalogSync.refreshProducts()
      .then(updated => {
        if (updated) this.loadDashboard(false)
      })
      .catch(error => {
        console.warn('首页商品数据更新失败：', error.message || error)
        this.setData({ syncError: true })
      })
      .finally(() => {
        this._refreshing = false
        this.setData({ isSyncing: false })
      })
  },

  retryLoad() {
    if (this.data.isLoading) return
    this.setData({ isLoading: true, loadFailed: false, syncError: false })
    this.loadDashboard(true)
  },

  retrySync() {
    this.refreshCatalog()
  },

  navigateOnce(method, url) {
    if (this._navigationPending) return
    this._navigationPending = true
    wx[method]({
      url,
      fail: error => {
        console.warn(`页面跳转失败：${url}`, error)
        wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
      },
      complete: () => {
        setTimeout(() => { this._navigationPending = false }, 400)
      }
    })
  },

  chooseBusiness(itemList, urls) {
    if (this._navigationPending) return
    this._navigationPending = true
    wx.showActionSheet({
      itemList,
      success: result => this.navigateOnceAfterChoice(urls[result.tapIndex]),
      complete: result => {
        if (!result || !Number.isInteger(result.tapIndex)) this._navigationPending = false
      }
    })
  },

  navigateOnceAfterChoice(url) {
    wx.navigateTo({
      url,
      fail: error => {
        console.warn(`页面跳转失败：${url}`, error)
        wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
      },
      complete: () => {
        setTimeout(() => { this._navigationPending = false }, 400)
      }
    })
  },

  goSale() {
    this.chooseBusiness(['卖出服装', '卖出化妆品'], [
      '/pages/sale-form/index?type=clothing',
      '/pages/sale-form/index?type=cosmetics'
    ])
  },

  goPurchase() {
    this.chooseBusiness(['服装 · 登记拿货', '化妆品 · 登记拿货'], [
      '/pages/purchase-form/index?type=clothing',
      '/pages/purchase-form/index?type=cosmetics'
    ])
  },

  goLedgerEntry() {
    this.navigateOnce('navigateTo', '/pages/profit-form/index?type=clothing')
  },

  openAttention(event) {
    this.navigateOnce('navigateTo', `/pages/product-detail/index?id=${event.currentTarget.dataset.id}`)
  },

  goAttentionAll() {
    if (this.data.hasStockAlerts && this.data.hasExpiryAlerts) {
      this.chooseBusiness(['查看库存预警', '查看化妆品提醒'], [
        '/pages/stock-overview/index?mode=low',
        '/pages/cosmetics/index'
      ])
      return
    }
    const url = this.data.hasExpiryAlerts
      ? '/pages/cosmetics/index'
      : '/pages/stock-overview/index?mode=low'
    this.navigateOnce('navigateTo', url)
  },

  goStockOverview() {
    this.navigateOnce('navigateTo', '/pages/stock-overview/index?mode=all')
  },

  goRecentAll() {
    this.navigateOnce('switchTab', '/pages/profit/index')
  }
})
