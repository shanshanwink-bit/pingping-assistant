const store = require('../../utils/store')
const serverSync = require('../../utils/server-sync')
const auth = require('../../utils/auth')

const COLOR_PRESETS = ['黑色', '白色', '灰色', '米白色', '杏色', '蓝色', '粉色', '红色', '绿色', '卡其色']
const LETTER_SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '均码']
const NUMBER_SIZE_PRESETS = ['25', '26', '27', '28', '29', '30', '31']
const COSMETIC_COLOR_PRESETS = ['通用', '透明', '自然色', '象牙白', '浅肤色', '粉色', '红色']
const COSMETIC_SPEC_PRESETS = ['5g', '10g', '15g', '30g', '50g', '30ml', '50ml', '100ml', '200ml']

function splitValues(value) {
  const values = String(value || '')
    .split(/[,，、\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
  return values.filter((item, index) => values.indexOf(item) === index)
}

Page({
  data: {
    businessType: 'clothing',
    isCosmetics: false,
    quickCreate: false,
    quickClothing: false,
    quickCosmetics: false,
    isPants: false,
    showSpecs: true,
    showAdvanced: true,
    editing: false,
    saving: false,
    saveButtonText: '先创建商品',
    productId: '',
    nameLabel: '商品名称',
    namePlaceholder: '例如：圆领针织衫',
    categoryLabel: '商品分类',
    categories: ['上衣', '裤子', '裙子', '外套', '其他'],
    colorLabel: '颜色',
    sizeLabel: '尺码',
    colorPlaceholder: '白色，黑色，杏色',
    sizePlaceholder: 'S，M，L，XL',
    categoryIndex: 0,
    colorPresets: COLOR_PRESETS.map(value => ({ value, selected: false })),
    letterSizePresets: LETTER_SIZE_PRESETS.map(value => ({ value, selected: false })),
    numberSizePresets: NUMBER_SIZE_PRESETS.map(value => ({ value, selected: false })),
    cosmeticColorPresets: COSMETIC_COLOR_PRESETS.map(value => ({ value, selected: false })),
    cosmeticSpecPresets: COSMETIC_SPEC_PRESETS.map(value => ({ value, selected: false })),
    supplierOptions: [],
    brandOptions: [],
    variantCount: 0,
    variants: [],
    form: {
      name: '',
      category: '上衣',
      itemNumber: '',
      image: '',
      costPrice: '',
      salePrice: '',
      supplier: '',
      brand: '',
      batchNumber: '',
      expiryDate: '',
      location: '',
      lowStockThreshold: 3,
      colors: '',
      sizes: ''
    }
  },

  onLoad(options) {
    const settings = options || {}
    if (settings.id && !auth.canEditProducts()) {
      wx.showToast({ title: '仅店主可编辑商品资料', icon: 'none' })
      return setTimeout(() => wx.navigateBack(), 500)
    }
    const product = settings.id ? store.getProduct(settings.id) : null
    if (settings.id && !product) {
      wx.showToast({ title: '商品不存在', icon: 'none' })
      return setTimeout(() => wx.navigateBack(), 500)
    }
    const isCosmetics = product ? product.businessType === 'cosmetics' : settings.type === 'cosmetics'
    const categories = isCosmetics ? ['护肤', '彩妆', '香水', '洗护', '其他'] : ['上衣', '裤子', '裙子', '外套', '其他']
    const categoryIndex = product ? Math.max(0, categories.indexOf(product.category)) : 0
    const productColors = product ? product.specs.map(item => item.color).filter((item, index, list) => item !== '通用' && item !== '默认' && list.indexOf(item) === index) : []
    const productSizes = product ? product.specs.map(item => item.size).filter((item, index, list) => list.indexOf(item) === index) : []
    const variants = product ? product.specs.map(item => ({
      key: `${item.color === '默认' ? '通用' : item.color}__${item.size}`,
      id: item.id,
      color: item.color === '默认' ? '通用' : item.color,
      size: item.size,
      stock: String(item.stock)
    })) : []
    this.setData({
      businessType: isCosmetics ? 'cosmetics' : 'clothing',
      isCosmetics,
      quickCreate: !product,
      quickClothing: !product && !isCosmetics,
      quickCosmetics: !product && isCosmetics,
      isPants: !isCosmetics && categories[categoryIndex] === '裤子',
      showSpecs: Boolean(product),
      showAdvanced: Boolean(product),
      editing: Boolean(product),
      saveButtonText: product ? '保存修改' : isCosmetics ? '先创建化妆品' : '先创建商品',
      productId: product ? product.id : '',
      categories,
      categoryIndex,
      nameLabel: isCosmetics ? '化妆品名称' : '商品名称',
      namePlaceholder: isCosmetics ? '例如：水润修护精华液' : '例如：圆领针织衫',
      categoryLabel: isCosmetics ? '化妆品分类' : '商品分类',
      colorLabel: isCosmetics ? '款式 / 色号' : '颜色',
      sizeLabel: isCosmetics ? '容量 / 规格' : '尺码',
      colorPlaceholder: isCosmetics ? '可选，例如：自然色，象牙白' : '白色，黑色，杏色',
      sizePlaceholder: isCosmetics ? '例如：30ml，50ml，100ml' : 'S，M，L，XL',
      variantCount: variants.length,
      variants,
      form: product ? {
        name: product.name || '',
        category: product.category || categories[categoryIndex],
        itemNumber: product.itemNumber || '',
        image: product.image || '',
        costPrice: product.costPrice || '',
        salePrice: product.salePrice || '',
        supplier: product.supplier || '',
        brand: product.brand || '',
        batchNumber: product.batchNumber || '',
        expiryDate: product.expiryDate || '',
        location: product.location || '',
        lowStockThreshold: product.lowStockThreshold === undefined ? (isCosmetics ? 0 : 3) : product.lowStockThreshold,
        colors: productColors.join('，'),
        sizes: productSizes.join('，')
      } : {
        ...this.data.form,
        category: categories[0],
        lowStockThreshold: isCosmetics ? 0 : 3
      }
    }, () => {
      this.syncPresetSelections()
      this.syncSupplierOptions()
      this.syncBrandOptions()
    })
    wx.setNavigationBarTitle({ title: product ? '编辑商品' : isCosmetics ? '新建化妆品' : '新建服装' })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value }, () => {
      if (field === 'colors' || field === 'sizes') {
        this.updateVariants()
        this.syncPresetSelections()
      }
      if (field === 'supplier') this.syncSupplierOptions()
      if (field === 'brand') this.syncBrandOptions()
    })
  },

  syncSupplierOptions() {
    const selectedSupplier = String(this.data.form.supplier || '').trim()
    this.setData({
      supplierOptions: store.getSuppliers().map(value => ({
        value,
        selected: value === selectedSupplier
      }))
    })
  },

  selectSupplier(event) {
    const supplier = event.currentTarget.dataset.value
    const nextValue = this.data.form.supplier === supplier ? '' : supplier
    this.setData({ 'form.supplier': nextValue }, () => this.syncSupplierOptions())
  },

  syncBrandOptions() {
    const selectedBrand = String(this.data.form.brand || '').trim()
    this.setData({
      brandOptions: store.getBrands().map(value => ({
        value,
        selected: value === selectedBrand
      }))
    })
  },

  selectBrand(event) {
    const brand = event.currentTarget.dataset.value
    const nextValue = this.data.form.brand === brand ? '' : brand
    this.setData({ 'form.brand': nextValue }, () => this.syncBrandOptions())
  },

  syncPresetSelections() {
    const colors = splitValues(this.data.form.colors)
    const sizes = splitValues(this.data.form.sizes)
    this.setData({
      colorPresets: COLOR_PRESETS.map(value => ({ value, selected: colors.includes(value) })),
      letterSizePresets: LETTER_SIZE_PRESETS.map(value => ({ value, selected: sizes.includes(value) })),
      numberSizePresets: NUMBER_SIZE_PRESETS.map(value => ({ value, selected: sizes.includes(value) })),
      cosmeticColorPresets: COSMETIC_COLOR_PRESETS.map(value => ({ value, selected: colors.includes(value) })),
      cosmeticSpecPresets: COSMETIC_SPEC_PRESETS.map(value => ({ value, selected: sizes.includes(value) }))
    })
  },

  togglePreset(event) {
    const field = event.currentTarget.dataset.field
    const value = event.currentTarget.dataset.value
    const values = splitValues(this.data.form[field])
    const index = values.indexOf(value)
    if (index >= 0) values.splice(index, 1)
    else values.push(value)

    const colorCount = field === 'colors'
      ? Math.max(values.length, 1)
      : Math.max(splitValues(this.data.form.colors).length, 1)
    const sizeCount = field === 'sizes'
      ? values.length
      : splitValues(this.data.form.sizes).length
    if (colorCount * sizeCount > 40) {
      return wx.showToast({ title: '一次最多选择 40 个组合规格', icon: 'none' })
    }

    this.setData({ [`form.${field}`]: values.join('，') }, () => {
      this.updateVariants()
      this.syncPresetSelections()
    })
  },

  onCategoryChange(event) {
    const categoryIndex = Number(event.detail.value)
    const category = this.data.categories[categoryIndex]
    this.setData({
      categoryIndex,
      isPants: !this.data.isCosmetics && category === '裤子',
      'form.category': category
    })
  },

  onExpiryChange(event) {
    this.setData({ 'form.expiryDate': event.detail.value })
  },

  toggleSpecs() {
    this.setData({ showSpecs: !this.data.showSpecs })
  },

  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced })
  },

  updateVariants() {
    const enteredColors = splitValues(this.data.form.colors)
    const colors = enteredColors.length ? enteredColors : ['通用']
    const sizes = splitValues(this.data.form.sizes)
    const previous = {}
    this.data.variants.forEach(item => { previous[item.key] = { stock: item.stock, id: item.id } })
    const variants = []
    colors.forEach(color => {
      sizes.forEach(size => {
        const key = `${color}__${size}`
        variants.push({
          key,
          id: previous[key] ? previous[key].id : '',
          color,
          size,
          stock: previous[key] ? previous[key].stock : ''
        })
      })
    })
    this.setData({ variantCount: variants.length, variants })
  },

  onVariantStockInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ [`variants[${index}].stock`]: event.detail.value })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: result => {
        const tempFilePath = result.tempFiles[0].tempFilePath
        wx.saveFile({
          tempFilePath,
          success: saved => this.setData({ 'form.image': saved.savedFilePath }),
          fail: () => this.setData({ 'form.image': tempFilePath })
        })
      }
    })
  },

  removeImage() {
    this.setData({ 'form.image': '' })
  },

  async submit() {
    if (this.data.saving) return
    const form = this.data.form
    const itemNumber = String(form.itemNumber || '').trim()
    const enteredColors = splitValues(form.colors)
    const quickWithoutSpecs = this.data.quickCreate && !this.data.showSpecs
    const colors = enteredColors.length ? enteredColors : ['通用']
    const sizes = quickWithoutSpecs ? [this.data.isCosmetics ? '标准规格' : '均码'] : splitValues(form.sizes)
    if (!form.name.trim()) return wx.showToast({ title: `请填写${this.data.nameLabel}`, icon: 'none' })
    if ([...itemNumber].length > 80) return wx.showToast({ title: '货号最多 80 个字符', icon: 'none' })
    if (!sizes.length) return wx.showToast({ title: `请至少填写一个${this.data.sizeLabel}`, icon: 'none' })
    if (colors.length * sizes.length > 40) return wx.showToast({ title: '一次最多生成 40 个规格', icon: 'none' })

    const targetVariants = quickWithoutSpecs
      ? [{ id: '', color: '通用', size: this.data.isCosmetics ? '标准规格' : '均码', stock: '0' }]
      : this.data.variants
    const invalidStock = targetVariants.some(item => {
      const stock = item.stock === '' ? 0 : Number(item.stock)
      return !Number.isInteger(stock) || stock < 0
    })
    if (invalidStock) return wx.showToast({ title: '规格库存需填写非负整数', icon: 'none' })

    const specs = targetVariants.map(item => ({
      id: item.id,
      color: item.color,
      size: item.size,
      stock: item.stock === '' ? 0 : Number(item.stock)
    }))

    const normalizedForm = { ...form, itemNumber }
    this.setData({ saving: true })
    try {
      const existing = this.data.editing ? store.getProduct(this.data.productId) : null
      if (existing && existing.adminProductId) {
        await serverSync.updateProductProfile(existing.adminProductId, {
          name: String(normalizedForm.name || '').trim(),
          itemNumber,
          category: normalizedForm.category,
          salePrice: Number(normalizedForm.salePrice || 0),
          costPrice: Number(normalizedForm.costPrice || 0),
          status: existing.status || '销售中'
        })
      }
      const product = this.data.editing
        ? store.updateProduct(this.data.productId, { ...normalizedForm, businessType: this.data.businessType, specs })
        : store.addProduct({ ...normalizedForm, businessType: this.data.businessType, specs })
      wx.showToast({ title: this.data.editing ? '商品已更新' : '商品已创建', icon: 'success' })
      setTimeout(() => {
        if (this.data.quickCreate) {
          wx.redirectTo({ url: `/pages/product-detail/index?id=${product.id}` })
        } else {
          wx.navigateBack()
        }
      }, 700)
    } catch (error) {
      wx.showToast({ title: error.message || '商品保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
