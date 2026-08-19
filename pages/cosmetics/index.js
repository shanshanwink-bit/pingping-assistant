const store = require('../../utils/store')

Page({
  data: {
    keyword: '',
    categories: ['全部', '护肤', '彩妆', '香水', '洗护', '其他'],
    activeCategory: '全部',
    products: [],
    filteredProducts: [],
    summary: {
      totalStock: 0,
      productCount: 0,
      todaySaleQuantity: 0
    },
    todayStockSaveCount: 0,
    todaySaleAmountText: '¥0.00'
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 1 })
    const summary = store.getSummary('cosmetics')
    const products = store.getProducts('cosmetics').map(item => ({
      ...item,
      specCount: item.specCount || item.specs.length,
      stockStatus: item.specs.some(spec => spec.stock <= item.lowStockThreshold) ? '含低库存规格' : '库存正常'
    }))
    const cosmeticIds = products.map(item => item.id)
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayStockSaveCount = store.getState().operations.filter(item => (
      (item.type === 'inbound' || item.type === 'stocktake') &&
      (item.businessType === 'cosmetics' || cosmeticIds.includes(item.productId)) &&
      String(item.createdAt || '').slice(0, 10) === today
    )).length
    this.setData({
      products,
      summary,
      todayStockSaveCount,
      todaySaleAmountText: `¥${Number(summary.todaySaleAmount || 0).toFixed(2)}`
    }, () => this.applyFilter())
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value }, () => this.applyFilter())
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category }, () => this.applyFilter())
  },

  applyFilter() {
    const keyword = this.data.keyword.trim().toLowerCase()
    const category = this.data.activeCategory
    const filteredProducts = this.data.products.filter(item => {
      const matchKeyword = !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        String(item.itemNumber || '').toLowerCase().includes(keyword)
      const matchCategory = category === '全部' || item.category === category
      return matchKeyword && matchCategory
    })
    this.setData({ filteredProducts })
  },

  addProduct() {
    wx.navigateTo({ url: '/pages/product-form/index?type=cosmetics' })
  },

  addSale() {
    wx.navigateTo({ url: '/pages/sale-form/index?type=cosmetics' })
  },

  openStockRecords() {
    wx.navigateTo({ url: '/pages/operations/index?type=cosmetics&mode=stock-records' })
  },

  openSales() {
    wx.navigateTo({ url: '/pages/sales/index?type=cosmetics' })
  },

  openProduct(event) {
    wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` })
  }
})
