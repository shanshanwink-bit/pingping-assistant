const store = require('../../utils/store')
const { visibleSpecs } = require('../../utils/product-specs')

const TYPE_META = {
  inbound: { title: '商品入库', quantityLabel: '入库数量', buttonText: '确认入库', reasons: ['采购入库', '顾客退货', '盘盈补录', '其他入库'] },
  outbound: { title: '商品出库', quantityLabel: '出库数量', buttonText: '确认出库', reasons: ['销售出库', '退回供应商', '商品损坏', '赠送', '其他出库'] },
  stocktake: { title: '库存盘点', quantityLabel: '实际库存数量', buttonText: '确认盘点', reasons: ['日常盘点', '月末盘点', '盘点修正'] }
}

Page({
  data: {
    type: 'inbound',
    businessType: '',
    simpleMode: false,
    increaseMode: false,
    bannerIcon: '入',
    bannerSub: '每次操作都会保存时间、人员和库存变化',
    specLabel: '颜色 / 尺码',
    meta: TYPE_META.inbound,
    products: [],
    productNames: [],
    productIndex: 0,
    currentProduct: null,
    specNames: [],
    specIndex: 0,
    currentSpec: null,
    quantity: '',
    reasonIndex: 0,
    remark: ''
  },

  onLoad(options) {
    const type = TYPE_META[options.type] ? options.type : 'inbound'
    const businessType = options.businessType || ''
    const increaseMode = businessType === 'cosmetics' && options.mode === 'save'
    const simpleMode = businessType === 'cosmetics' && (increaseMode || options.mode === 'adjust')
    const products = store.getProducts(businessType || undefined)
    let productIndex = 0
    if (options.productId) {
      const foundIndex = products.findIndex(item => item.id === options.productId)
      if (foundIndex >= 0) productIndex = foundIndex
    }
    const meta = increaseMode
      ? { title: '增加库存', quantityLabel: '增加数量', buttonText: '确认增加', reasons: ['库存增加'] }
      : simpleMode
        ? { title: '化妆品盘点', quantityLabel: '实际库存数量', buttonText: '确认盘点', reasons: ['库存盘点'] }
        : TYPE_META[type]
    wx.setNavigationBarTitle({ title: meta.title })
    this.setData({
      type,
      businessType,
      simpleMode,
      increaseMode,
      bannerIcon: increaseMode ? '库' : type === 'inbound' ? '入' : type === 'outbound' ? '出' : '盘',
      bannerSub: increaseMode ? '填写本次需要增加的库存数量' : simpleMode ? '填写盘点后的实际库存数量' : '每次操作都会保存时间、人员和库存变化',
      specLabel: businessType === 'cosmetics' ? '色号 / 容量' : '颜色 / 尺码',
      meta,
      products,
      productNames: products.map(item => `${item.name}（${item.itemNumber ? `货号 ${item.itemNumber}` : '货号未填写'}）`),
      productIndex
    }, () => this.syncProduct())
  },

  syncProduct() {
    const selectedProduct = this.data.products[this.data.productIndex] || null
    const currentProduct = selectedProduct
      ? { ...selectedProduct, specs: visibleSpecs(selectedProduct.specs) }
      : null
    const specs = currentProduct ? currentProduct.specs : []
    this.setData({
      currentProduct,
      specIndex: 0,
      specNames: specs.map(item => `${item.color} / ${item.size}（库存 ${item.stock}）`),
      currentSpec: specs[0] || null,
      quantity: this.data.type === 'stocktake' && !this.data.increaseMode && specs[0] ? String(specs[0].stock) : ''
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
      quantity: this.data.type === 'stocktake' && !this.data.increaseMode ? String(currentSpec.stock) : ''
    })
  },

  onReasonChange(event) {
    this.setData({ reasonIndex: Number(event.detail.value) })
  },

  onQuantityInput(event) {
    this.setData({ quantity: event.detail.value })
  },

  onRemarkInput(event) {
    this.setData({ remark: event.detail.value })
  },

  submit() {
    if (!this.data.currentProduct || !this.data.currentSpec) {
      return wx.showToast({ title: '暂无可操作商品', icon: 'none' })
    }
    if (this.data.quantity === '') return wx.showToast({ title: '请填写数量', icon: 'none' })
    const inputQuantity = Number(this.data.quantity)
    if (this.data.increaseMode && (!Number.isInteger(inputQuantity) || inputQuantity <= 0)) {
      return wx.showToast({ title: '请输入大于 0 的整数', icon: 'none' })
    }
    const reason = this.data.increaseMode ? '库存增加' : this.data.simpleMode ? '库存盘点' : this.data.meta.reasons[this.data.reasonIndex]
    try {
      store.updateStock({
        type: this.data.increaseMode ? 'inbound' : this.data.type,
        productId: this.data.currentProduct.id,
        specId: this.data.currentSpec.id,
        quantity: inputQuantity,
        reason: !this.data.simpleMode && this.data.remark.trim() ? `${reason}：${this.data.remark.trim()}` : reason
      })
      wx.showToast({ title: this.data.increaseMode ? '库存已增加' : '库存已更新', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
