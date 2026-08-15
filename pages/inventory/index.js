const store = require('../../utils/store')

const BUSINESS_META = {
  clothing: {
    title: '服装',
    categories: ['全部', '上衣', '裤子', '裙子', '外套', '其他'],
    icon: '/assets/icons/brand-water-hanger.svg',
    placeholder: '/assets/icons/shirt-blue.svg'
  },
  cosmetics: {
    title: '化妆品',
    categories: ['全部', '护肤', '彩妆', '香水', '洗护', '其他'],
    icon: '/assets/icons/tab-cosmetics-active.svg',
    placeholder: '/assets/icons/tab-cosmetics-active.svg'
  }
}

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    businessTabs: [
      { value: 'clothing', label: '服装' },
      { value: 'cosmetics', label: '化妆品' }
    ],
    activeBusinessType: 'clothing',
    businessTitle: '服装',
    businessIcon: BUSINESS_META.clothing.icon,
    placeholderIcon: BUSINESS_META.clothing.placeholder,
    keyword: '',
    categories: BUSINESS_META.clothing.categories,
    activeCategory: '全部',
    products: [],
    filteredProducts: [],
    summary: { totalStock: 0, productCount: 0, stockValue: 0, todaySaleQuantity: 0 },
    stockValueText: '¥0.00'
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 1 })
    const preferred = wx.getStorageSync('product_business_filter')
    if (preferred === 'clothing' || preferred === 'cosmetics') {
      wx.removeStorageSync('product_business_filter')
      this.setData({ activeBusinessType: preferred, keyword: '', activeCategory: '全部' })
    }
    this.loadBusiness()
  },

  loadBusiness() {
    const type = this.data.activeBusinessType
    const meta = BUSINESS_META[type]
    const summary = store.getSummary(type)
    const products = store.getProducts(type).map(item => ({
      ...item,
      specCount: item.specs.length,
      stockStatus: item.specs.some(spec => spec.stock === 0)
        ? '有缺货'
        : item.specs.some(spec => spec.stock <= item.lowStockThreshold) ? '库存不多' : '库存正常'
    }))
    this.setData({
      businessTitle: meta.title,
      businessIcon: meta.icon,
      placeholderIcon: meta.placeholder,
      categories: meta.categories,
      products,
      summary,
      stockValueText: money(summary.stockValue)
    }, () => this.applyFilter())
  },

  selectBusiness(event) {
    const activeBusinessType = event.currentTarget.dataset.type
    if (activeBusinessType === this.data.activeBusinessType) return
    this.setData({ activeBusinessType, keyword: '', activeCategory: '全部' }, () => this.loadBusiness())
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
      return matchKeyword && (category === '全部' || item.category === category)
    })
    this.setData({ filteredProducts })
  },

  addProduct() {
    wx.navigateTo({ url: `/pages/product-form/index?type=${this.data.activeBusinessType}` })
  },

  addSale() {
    wx.navigateTo({ url: `/pages/sale-form/index?type=${this.data.activeBusinessType}` })
  },

  openStockRecords() {
    const type = this.data.activeBusinessType
    const url = type === 'clothing'
      ? '/pages/purchases/index?type=clothing'
      : '/pages/operations/index?type=cosmetics&mode=stock-records'
    wx.navigateTo({ url })
  },

  openSales() {
    wx.navigateTo({ url: `/pages/sales/index?type=${this.data.activeBusinessType}` })
  },

  openLowStock() {
    wx.navigateTo({ url: `/pages/stock-overview/index?mode=low&type=${this.data.activeBusinessType}` })
  },

  openProduct(event) {
    wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` })
  }
})
