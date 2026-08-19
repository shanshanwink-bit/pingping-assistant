const auth = require('./auth')
const serverSync = require('./server-sync')
const store = require('./store')
const form = require('./transaction-form')
const { createTransactionSubmitter } = require('./transaction-submit')

const submitter = createTransactionSubmitter({
  commitSale: payload => serverSync.commitSale(payload),
  commitPurchase: payload => serverSync.commitPurchase(payload),
  persist: state => store.replaceStateFromServer(state, auth.getCurrentUser() || state.currentUser || {})
})

function initialData(mode) {
  const sale = mode === 'sale'
  return {
    mode,
    pageTitle: sale ? '卖货' : '拿货',
    pageHint: sale ? '选择商品和规格，确认本次实际成交' : '选择商品和规格，登记本次入库成本',
    amountLabel: sale ? '销售单价' : '进货单价',
    totalLabel: sale ? '应收' : '本次成本',
    submitLabel: sale ? '确认卖出' : '确认入库',
    continueLabel: sale ? '继续卖货' : '继续拿货',
    businessType: '',
    preferredProductId: '',
    preferredSpecId: '',
    products: [],
    productOptions: [],
    keyword: '',
    showProductChooser: true,
    currentProduct: null,
    specOptions: [],
    currentSpec: null,
    quantity: '',
    unitAmount: '',
    paymentMethods: ['微信', '支付宝', '现金', '银行卡', '未记录'],
    paymentIndex: 4,
    supplier: '',
    note: '',
    showMore: false,
    isLoading: true,
    isSubmitting: false,
    canSubmit: false,
    errorText: '请选择商品',
    totalAmountText: '¥0.00',
    unitAmountDisplay: '¥0.00',
    beforeStockText: '0',
    afterStockText: '0',
    summaryProductName: '未选择商品',
    summarySpecText: '未选择规格',
    outOfStock: false,
    submitErrorTitle: '',
    submitErrorText: '',
    success: false,
    successView: null,
    pendingTransactionId: ''
  }
}

function createTransactionPage(mode) {
  const sale = mode === 'sale'
  return {
    data: initialData(mode),

    onLoad(options) {
      const selection = form.selectionFromQuery(options)
      this.setData({
        businessType: selection.businessType,
        preferredProductId: selection.productId,
        preferredSpecId: selection.specId
      }, () => {
        this._initialized = true
        this.loadProducts(false)
      })
      wx.setNavigationBarTitle({ title: sale ? '卖货' : '拿货' })
    },

    onShow() {
      if (this.data.success || !this._initialized) return
      this.loadProducts(true)
    },

    loadProducts(preserveValues) {
      try {
        const products = store.getProducts(this.data.businessType || undefined)
        const productId = this.data.preferredProductId || (preserveValues && this.data.currentProduct && this.data.currentProduct.id) || ''
        const product = form.resolveProduct(products, productId)
        this.setData({
          products,
          productOptions: form.productOptions(products, this.data.keyword),
          isLoading: false,
          showProductChooser: !product
        }, () => this.applyProduct(product, this.data.preferredSpecId, preserveValues))
      } catch (error) {
        console.error(`${this.data.pageTitle}商品读取失败：`, error)
        this.setData({ isLoading: false, submitErrorTitle: '商品加载失败', submitErrorText: '请返回后重试' })
      }
    },

    applyProduct(product, preferredSpecId, preserveValues) {
      if (!product) {
        this.setData({ currentProduct: null, currentSpec: null, specOptions: [], quantity: '', unitAmount: '' }, () => this.recalculate())
        return
      }
      const specs = form.specOptions(product, mode)
      const preservedSpecId = preserveValues && this.data.currentSpec ? this.data.currentSpec.id : ''
      const currentSpec = form.resolveSpec(product, preferredSpecId || preservedSpecId, mode)
      const quantity = preserveValues && this.data.quantity ? this.data.quantity : '1'
      const unitAmount = preserveValues && this.data.unitAmount !== ''
        ? this.data.unitAmount
        : form.defaultUnitAmount(product, mode)
      this.setData({
        currentProduct: product,
        currentSpec,
        specOptions: specs,
        quantity,
        unitAmount,
        supplier: preserveValues ? this.data.supplier : String(product.supplier || ''),
        showProductChooser: false,
        preferredProductId: product.id,
        preferredSpecId: currentSpec ? currentSpec.id : '',
        pendingTransactionId: ''
      }, () => this.recalculate())
    },

    onProductSearch(event) {
      const keyword = event.detail.value
      this.setData({ keyword, productOptions: form.productOptions(this.data.products, keyword) })
    },

    clearProductSearch() {
      this.setData({ keyword: '', productOptions: form.productOptions(this.data.products, '') })
    },

    toggleProductChooser() {
      this.setData({ showProductChooser: !this.data.showProductChooser })
    },

    selectProduct(event) {
      const product = form.resolveProduct(this.data.products, event.currentTarget.dataset.id)
      this.setData({ keyword: '' }, () => this.applyProduct(product, '', false))
    },

    selectSpec(event) {
      const spec = this.data.specOptions.find(item => item.id === String(event.currentTarget.dataset.id || ''))
      if (!spec || spec.disabled) {
        wx.showToast({ title: '该规格已缺货', icon: 'none' })
        return
      }
      this.setData({ currentSpec: spec, preferredSpecId: spec.id, pendingTransactionId: '' }, () => this.recalculate())
    },

    onQuantityInput(event) {
      this.setData({ quantity: event.detail.value, pendingTransactionId: '' }, () => this.recalculate())
    },

    decreaseQuantity() {
      this.setData({ quantity: String(form.stepQuantity(this.data.quantity, -1)), pendingTransactionId: '' }, () => this.recalculate())
    },

    increaseQuantity() {
      const maximum = sale && this.data.currentSpec ? this.data.currentSpec.stock : undefined
      this.setData({ quantity: String(form.stepQuantity(this.data.quantity, 1, maximum)), pendingTransactionId: '' }, () => this.recalculate())
    },

    onAmountInput(event) {
      this.setData({ unitAmount: event.detail.value, pendingTransactionId: '' }, () => this.recalculate())
    },

    selectPayment(event) {
      this.setData({ paymentIndex: Number(event.currentTarget.dataset.index), pendingTransactionId: '' })
    },

    toggleMore() {
      this.setData({ showMore: !this.data.showMore })
    },

    onOptionalInput(event) {
      this.setData({ [event.currentTarget.dataset.field]: event.detail.value, pendingTransactionId: '' })
    },

    recalculate() {
      const view = form.transactionState({
        mode,
        product: this.data.currentProduct,
        spec: this.data.currentSpec,
        quantity: this.data.quantity,
        unitAmount: this.data.unitAmount
      })
      this.setData({
        canSubmit: view.canSubmit,
        errorText: view.errorText,
        totalAmountText: view.totalAmountText,
        unitAmountDisplay: view.unitAmountText,
        beforeStockText: view.beforeStockText,
        afterStockText: view.afterStockText,
        summaryProductName: view.productName,
        summarySpecText: view.specText,
        outOfStock: view.outOfStock,
        submitErrorTitle: '',
        submitErrorText: ''
      })
      return view
    },

    async submit() {
      if (this.data.isSubmitting) return
      const view = this.recalculate()
      if (!view.canSubmit) return
      const id = this.data.pendingTransactionId || form.transactionId(mode)
      const payload = {
        transactionId: id,
        productId: this.data.currentProduct.id,
        specId: this.data.currentSpec.id,
        quantity: view.quantity,
        note: this.data.note
      }
      if (sale) {
        payload.unitPrice = view.unitAmount
        payload.paymentMethod = this.data.paymentMethods[this.data.paymentIndex]
      } else {
        payload.unitCost = view.unitAmount
        payload.supplier = this.data.supplier
      }

      this.setData({ isSubmitting: true, pendingTransactionId: id, submitErrorTitle: '', submitErrorText: '' })
      try {
        const result = await submitter.submit(mode, payload)
        this.setData({
          success: true,
          successView: form.successPresentation(mode, result.transaction),
          pendingTransactionId: ''
        })
      } catch (error) {
        console.warn(`${this.data.pageTitle}提交失败：`, error.message || error)
        this.setData({
          submitErrorTitle: sale ? '卖货失败' : '入库失败',
          submitErrorText: error.message || '请稍后重试'
        })
      } finally {
        this.setData({ isSubmitting: false })
      }
    },

    continueTransaction() {
      this.setData({ success: false, successView: null, quantity: '1', note: '', pendingTransactionId: '' }, () => this.loadProducts(false))
    },

    finish() {
      wx.navigateBack({ delta: 1 })
    },

    viewProduct() {
      if (!this.data.currentProduct) return
      wx.navigateTo({ url: `/pages/product-detail/index?id=${encodeURIComponent(this.data.currentProduct.id)}` })
    }
  }
}

module.exports = { createTransactionPage, initialData }
