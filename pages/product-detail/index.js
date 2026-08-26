const store = require('../../utils/store')
const catalogSync = require('../../utils/catalog-sync')
const { buildProductDetail } = require('../../utils/product-display')

function decoded(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch (error) {
    return String(value || '')
  }
}

Page({
  data: {
    productId: '',
    product: null,
    imageFailed: false,
    isLoading: true,
    isRefreshing: false,
    loadError: false,
    isNavigating: false
  },

  onLoad(options) {
    this.setData({ productId: decoded(options.id) })
  },

  onShow() {
    this.setData({ isNavigating: false })
    const hasProduct = this.loadCachedProduct()
    this.refreshProduct(!hasProduct)
  },

  loadCachedProduct() {
    if (!this.data.productId) {
      this.setData({ isLoading: false, loadError: true, product: null })
      return false
    }
    try {
      const rawProduct = store.getProduct(this.data.productId)
      if (!rawProduct) return false
      this.setData({
        product: buildProductDetail(rawProduct, { imageFailed: this.data.imageFailed, now: new Date() }),
        isLoading: false,
        loadError: false
      })
      return true
    } catch (error) {
      console.error('商品详情读取失败：', error)
      this.setData({ isLoading: false, loadError: true, product: null })
      return false
    }
  },

  refreshProduct(showLoading) {
    if (this.data.isRefreshing || !this.data.productId) return
    this.setData({ isRefreshing: true, isLoading: Boolean(showLoading), loadError: false })
    catalogSync.refreshProducts()
      .then(() => {
        if (!this.loadCachedProduct()) this.setData({ isLoading: false, loadError: true, product: null })
      })
      .catch(error => {
        console.warn('商品详情刷新失败：', error.message || error)
        if (!this.data.product) this.setData({ isLoading: false, loadError: true })
      })
      .finally(() => this.setData({ isRefreshing: false, isLoading: false }))
  },

  retryLoad() {
    if (this.data.isRefreshing) return
    this.setData({ isLoading: true, loadError: false })
    const hasProduct = this.loadCachedProduct()
    this.refreshProduct(!hasProduct)
  },

  onImageError() {
    if (this.data.imageFailed) return
    this.setData({ imageFailed: true }, () => this.loadCachedProduct())
  },

  openSale() {
    this.openOperation('/pages/sale-form/index')
  },

  openPurchase() {
    this.openOperation('/pages/purchase-form/index')
  },

  openOperation(path) {
    if (!this.data.product || this.data.isNavigating) return
    if (!this.data.product.isActive) {
      wx.showToast({ title: '商品已停用，请先重新启用', icon: 'none' })
      return
    }
    this.setData({ isNavigating: true })
    const specs = Array.isArray(this.data.product.specs) ? this.data.product.specs : []
    const params = [
      `type=${encodeURIComponent(this.data.product.businessType)}`,
      `productId=${encodeURIComponent(this.data.product.id)}`
    ]
    if (specs.length === 1 && specs[0].id) params.push(`specId=${encodeURIComponent(specs[0].id)}`)
    wx.navigateTo({
      url: `${path}?${params.join('&')}`,
      fail: () => {
        this.setData({ isNavigating: false })
        wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
      }
    })
  }
})
