const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    businessType: '',
    specLabel: '颜色 / 尺码',
    emptyIcon: '衣',
    successText: '卖货已记录',
    emptyHint: '卖货前，需要先创建商品并完成拿货。',
    preferredProductId: '',
    products: [],
    productNames: [],
    productIndex: 0,
    currentProduct: null,
    specNames: [],
    specIndex: 0,
    currentSpec: null,
    quantity: '',
    unitPrice: '',
    totalAmountText: '¥0.00',
    afterStock: 0,
    showMore: false,
    paymentMethods: ['微信', '支付宝', '现金', '银行卡', '未记录'],
    paymentIndex: 0,
    note: ''
  },

  onLoad(options) {
    const isCosmetics = options.type === 'cosmetics'
    this.setData({
      preferredProductId: options.productId || '',
      businessType: options.type || '',
      specLabel: isCosmetics ? '色号 / 容量' : '颜色 / 尺码',
      emptyIcon: isCosmetics ? '妆' : '衣',
      successText: '卖货已记录',
      emptyHint: isCosmetics ? '卖货前，需要先创建商品并保存库存。' : '卖货前，需要先创建商品并完成拿货。'
    })
    wx.setNavigationBarTitle({ title: '卖货' })
  },

  onShow() {
    const products = store.getProducts(this.data.businessType || undefined)
    let productIndex = 0
    if (this.data.preferredProductId) {
      const found = products.findIndex(item => item.id === this.data.preferredProductId)
      if (found >= 0) productIndex = found
    }
    this.setData({
      products,
      productNames: products.map(item => `${item.name}（${item.code}${item.itemNumber ? ` · ${item.itemNumber}` : ''}）`),
      productIndex
    }, () => this.syncProduct())
  },

  syncProduct() {
    const currentProduct = this.data.products[this.data.productIndex] || null
    const specs = currentProduct ? currentProduct.specs : []
    this.setData({
      currentProduct,
      specIndex: 0,
      specNames: specs.map(item => `${item.color} / ${item.size}（库存 ${item.stock}）`),
      currentSpec: specs[0] || null,
      unitPrice: currentProduct && currentProduct.salePrice ? String(currentProduct.salePrice) : '',
      totalAmountText: money(Number(this.data.quantity || 0) * Number(currentProduct && currentProduct.salePrice || 0)),
      afterStock: Number(specs[0] && specs[0].stock || 0) - Number(this.data.quantity || 0)
    })
  },

  onProductChange(event) {
    this.setData({ productIndex: Number(event.detail.value) }, () => this.syncProduct())
  },

  onSpecChange(event) {
    const specIndex = Number(event.detail.value)
    const currentSpec = this.data.currentProduct.specs[specIndex]
    this.setData({
      specIndex,
      currentSpec,
      afterStock: Number(currentSpec.stock || 0) - Number(this.data.quantity || 0)
    })
  },

  selectPayment(event) {
    this.setData({ paymentIndex: Number(event.currentTarget.dataset.index) })
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (field === 'quantity' || field === 'unitPrice') {
      const quantity = field === 'quantity' ? value : this.data.quantity
      const unitPrice = field === 'unitPrice' ? value : this.data.unitPrice
      this.setData({
        [field]: value,
        totalAmountText: money(Number(quantity || 0) * Number(unitPrice || 0)),
        afterStock: Number(this.data.currentSpec && this.data.currentSpec.stock || 0) - Number(quantity || 0)
      })
      return
    }
    this.setData({ [field]: value })
  },

  addProduct() {
    wx.navigateTo({ url: `/pages/product-form/index?type=${this.data.businessType || 'clothing'}` })
  },

  submit() {
    if (!this.data.currentProduct || !this.data.currentSpec) return wx.showToast({ title: '请先新建商品', icon: 'none' })
    const quantity = Number(this.data.quantity)
    const unitPrice = Number(this.data.unitPrice)
    if (!Number.isInteger(quantity) || quantity <= 0) return wx.showToast({ title: '请填写正确的卖货数量', icon: 'none' })
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return wx.showToast({ title: '请填写单件卖价', icon: 'none' })
    try {
      store.addSale({
        productId: this.data.currentProduct.id,
        specId: this.data.currentSpec.id,
        quantity,
        unitPrice,
        paymentMethod: this.data.paymentMethods[this.data.paymentIndex],
        note: this.data.note
      })
      wx.showToast({ title: this.data.successText, icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
