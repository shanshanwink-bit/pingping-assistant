const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    businessType: '',
    specLabel: '颜色 / 尺码',
    emptyIcon: '衣',
    supplierPlaceholder: '例如：广州春禾服饰',
    preferredProductId: '',
    products: [],
    productNames: [],
    productIndex: 0,
    currentProduct: null,
    specNames: [],
    specIndex: 0,
    currentSpec: null,
    quantity: '',
    unitCost: '',
    totalCostText: '¥0.00',
    afterStock: 0,
    showMore: false,
    supplier: '',
    note: ''
  },

  onLoad(options) {
    this.setData({
      preferredProductId: options.productId || '',
      businessType: options.type || '',
      specLabel: options.type === 'cosmetics' ? '色号 / 容量' : '颜色 / 尺码',
      emptyIcon: options.type === 'cosmetics' ? '妆' : '衣',
      supplierPlaceholder: options.type === 'cosmetics' ? '例如：品牌方或美妆供应商' : '例如：广州春禾服饰'
    })
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
      unitCost: currentProduct && currentProduct.costPrice ? String(currentProduct.costPrice) : '',
      totalCostText: money(Number(this.data.quantity || 0) * Number(currentProduct && currentProduct.costPrice || 0)),
      afterStock: Number(specs[0] && specs[0].stock || 0) + Number(this.data.quantity || 0),
      supplier: currentProduct ? currentProduct.supplier || '' : ''
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
      afterStock: Number(currentSpec.stock || 0) + Number(this.data.quantity || 0)
    })
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (field === 'quantity' || field === 'unitCost') {
      const quantity = field === 'quantity' ? value : this.data.quantity
      const unitCost = field === 'unitCost' ? value : this.data.unitCost
      this.setData({
        [field]: value,
        totalCostText: money(Number(quantity || 0) * Number(unitCost || 0)),
        afterStock: Number(this.data.currentSpec && this.data.currentSpec.stock || 0) + Number(quantity || 0)
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
    const unitCost = Number(this.data.unitCost)
    if (!Number.isInteger(quantity) || quantity <= 0) return wx.showToast({ title: '请填写正确的拿货数量', icon: 'none' })
    if (!Number.isFinite(unitCost) || unitCost <= 0) return wx.showToast({ title: '请填写单件拿货价', icon: 'none' })
    try {
      store.addPurchase({
        productId: this.data.currentProduct.id,
        specId: this.data.currentSpec.id,
        quantity,
        unitCost,
        supplier: this.data.supplier,
        note: this.data.note
      })
      wx.showToast({ title: '拿货已入库', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
