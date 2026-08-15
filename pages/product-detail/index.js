const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: { productId: '', product: null, specs: [], averageCostText: '¥0.00', stockCostText: '¥0.00' },

  onLoad(options) {
    this.setData({ productId: options.id || '' })
  },

  onShow() {
    this.loadProduct()
  },

  loadProduct() {
    const product = store.getProduct(this.data.productId)
    if (!product) {
      wx.showToast({ title: '商品不存在', icon: 'none' })
      return setTimeout(() => wx.navigateBack(), 600)
    }
    const specs = product.specs.map(item => ({
      ...item,
      statusText: item.stock === 0 ? '缺货' : item.stock <= product.lowStockThreshold ? '偏低' : '正常'
    }))
    this.setData({
      product,
      specs,
      averageCostText: money(product.costPrice),
      stockCostText: money(Number(product.totalStock || 0) * Number(product.costPrice || 0))
    })
  },

  updateSpecStock(event) {
    const specId = event.currentTarget.dataset.id
    const spec = this.data.specs.find(item => item.id === specId)
    if (!spec) return
    const value = event.detail.value === undefined || event.detail.value === null
      ? ''
      : String(event.detail.value).trim()
    const quantity = Number(value)
    if (!value || !Number.isInteger(quantity) || quantity < 0) {
      wx.showToast({ title: '请输入不小于 0 的整数', icon: 'none' })
      return this.loadProduct()
    }
    if (quantity === Number(spec.stock)) return
    try {
      store.updateStock({
        type: 'stocktake',
        productId: this.data.productId,
        specId,
        quantity,
        reason: '修正规格库存'
      })
      this.loadProduct()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      this.loadProduct()
    }
  },

  goStockForm(event) {
    const type = event.currentTarget.dataset.type
    const businessType = this.data.product.businessType || 'clothing'
    const mode = businessType === 'cosmetics' ? '&mode=save' : ''
    wx.navigateTo({ url: `/pages/stock-form/index?type=${type}&productId=${this.data.productId}&businessType=${businessType}${mode}` })
  },

  goPurchase() {
    const businessType = this.data.product.businessType || 'clothing'
    wx.navigateTo({ url: `/pages/purchase-form/index?productId=${this.data.productId}&type=${businessType}` })
  },

  goSale() {
    const businessType = this.data.product.businessType || 'clothing'
    wx.navigateTo({ url: `/pages/sale-form/index?productId=${this.data.productId}&type=${businessType}` })
  },

  editProduct() {
    wx.navigateTo({ url: `/pages/product-form/index?id=${this.data.productId}` })
  },

  deleteProduct() {
    const product = this.data.product
    if (!product) return
    wx.showModal({
      title: '删除商品',
      content: `确定删除“${product.name}”吗？历史记录会保留。`,
      confirmText: '删除',
      confirmColor: '#d76f8f',
      success: result => {
        if (!result.confirm) return
        try {
          store.removeProduct(product.id)
          wx.showToast({ title: '商品已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' })
        }
      }
    })
  }
})
