const store = require('../../utils/store')
const catalogSync = require('../../utils/catalog-sync')
const {
  buildListProduct,
  filterProducts,
  productDetailUrl
} = require('../../utils/product-display')

Page({
  data: {
    typeFilters: [
      { value: 'all', label: '全部' },
      { value: 'clothing', label: '服装' },
      { value: 'cosmetics', label: '化妆品' }
    ],
    activeType: 'all',
    keyword: '',
    products: [],
    filteredProducts: [],
    failedImageIds: [],
    isLoading: true,
    isRetrying: false,
    loadFailed: false,
    syncFailed: false,
    emptyKind: 'none'
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 1 })
    const preferred = wx.getStorageSync('product_business_filter')
    if (preferred === 'clothing' || preferred === 'cosmetics') {
      wx.removeStorageSync('product_business_filter')
      this.setData({ activeType: preferred })
    }
    const hasCachedProducts = this.loadCachedProducts(true)
    this.refreshProducts(!hasCachedProducts)
  },

  loadCachedProducts(keepLoadingWhenEmpty) {
    try {
      const products = store.getProducts()
      this.setData({
        products,
        isLoading: Boolean(keepLoadingWhenEmpty && !products.length),
        loadFailed: false
      }, () => this.applyFilters())
      return products.length > 0
    } catch (error) {
      console.error('商品读取失败：', error)
      this.setData({ isLoading: false, loadFailed: true, filteredProducts: [] })
      return false
    }
  },

  refreshProducts(showLoading) {
    if (this.data.isRetrying) return
    this.setData({ isRetrying: true, isLoading: Boolean(showLoading), syncFailed: false })
    catalogSync.refreshProducts()
      .then(updated => {
        if (updated) this.loadCachedProducts(false)
      })
      .catch(error => {
        console.warn('商品刷新失败：', error.message || error)
        this.setData({
          syncFailed: true,
          loadFailed: !this.data.products.length
        })
      })
      .finally(() => this.setData({ isRetrying: false, isLoading: false }))
  },

  retryLoad() {
    if (this.data.isRetrying) return
    this.setData({ isLoading: !this.data.products.length, loadFailed: false })
    const hasCachedProducts = this.loadCachedProducts(true)
    this.refreshProducts(!hasCachedProducts)
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value }, () => this.applyFilters())
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.applyFilters())
  },

  selectType(event) {
    const activeType = event.currentTarget.dataset.type
    if (activeType === this.data.activeType) return
    this.setData({ activeType }, () => this.applyFilters())
  },

  applyFilters() {
    const filtered = filterProducts(this.data.products, {
      keyword: this.data.keyword,
      businessType: this.data.activeType
    })
    const failedImages = new Set(this.data.failedImageIds)
    let emptyKind = 'none'
    if (!filtered.length) {
      if (!this.data.products.length) emptyKind = 'empty'
      else if (this.data.keyword.trim()) emptyKind = 'search'
      else emptyKind = 'category'
    }
    this.setData({
      filteredProducts: filtered.map(product => buildListProduct(product, failedImages.has(String(product.id)))),
      emptyKind
    })
  },

  onProductImageError(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || this.data.failedImageIds.includes(id)) return
    this.setData({ failedImageIds: this.data.failedImageIds.concat(id) }, () => this.applyFilters())
  },

  openProduct(event) {
    wx.navigateTo({ url: productDetailUrl(event.currentTarget.dataset.id) })
  }
})
