const store = require('../../utils/store')
const catalogSync = require('../../utils/catalog-sync')

const MODE_META = {
  products: { title: '全部商品', subtitle: '查看当前所有商品', unit: '款商品' },
  low: { title: '低库存规格', subtitle: '库存已达到提醒数量', unit: '个规格' },
  out: { title: '已缺货', subtitle: '当前库存数量为 0', unit: '个规格' }
}

Page({
  data: {
    mode: 'products',
    meta: MODE_META.products,
    businessTabs: [
      { value: 'all', label: '全部' },
      { value: 'clothing', label: '服装' },
      { value: 'cosmetics', label: '化妆品' }
    ],
    activeBusiness: 'all',
    resultText: '共 0 款商品',
    rows: []
  },

  onLoad(options) {
    const mode = MODE_META[options.mode] ? options.mode : 'products'
    const meta = MODE_META[mode]
    const activeBusiness = options.type === 'clothing' || options.type === 'cosmetics' ? options.type : 'all'
    this.setData({ mode, meta, activeBusiness })
    wx.setNavigationBarTitle({ title: meta.title })
  },

  onShow() {
    this.loadRows()
    catalogSync.refreshProducts()
      .then(updated => { if (updated) this.loadRows() })
      .catch(error => console.warn('商品刷新失败：', error.message || error))
  },

  selectBusiness(event) {
    this.setData({ activeBusiness: event.currentTarget.dataset.type }, () => this.loadRows())
  },

  loadRows() {
    const businessType = this.data.activeBusiness === 'all' ? undefined : this.data.activeBusiness
    const products = store.getProducts(businessType)
    let rows = []
    let resultText = ''
    if (this.data.mode === 'products') {
      rows = products.map(product => ({
        id: product.id,
        productId: product.id,
        productName: product.name,
        code: product.code,
        image: product.image,
        businessType: product.businessType || 'clothing',
        businessText: product.businessType === 'cosmetics' ? '化妆品' : '服装',
        detailText: `${product.category} · ${product.specCount || product.specs.length} 个规格`,
        stockText: `${product.totalStock} 件`,
        statusText: product.totalStock === 0 ? '已缺货' : '库存中'
      }))
      resultText = `共 ${rows.length} 款商品`
    } else if (this.data.mode === 'low') {
      let lowSpecCount = 0
      products.forEach(product => {
        const lowSpecs = product.specs.filter(spec => Number(spec.stock) <= Number(product.lowStockThreshold || 0))
        if (!lowSpecs.length) return
        lowSpecCount += lowSpecs.length
        rows.push({
          id: product.id,
          productId: product.id,
          productName: product.name,
          code: product.code,
          image: product.image,
          businessType: product.businessType || 'clothing',
          businessText: product.businessType === 'cosmetics' ? '化妆品' : '服装',
          detailText: lowSpecs.map(spec => `${spec.color === '默认' ? '通用' : spec.color} / ${spec.size}（${spec.stock}件）`).join('、'),
          stockText: `${lowSpecs.length} 个规格`,
          statusText: lowSpecs.every(spec => Number(spec.stock) === 0) ? '全部缺货' : '库存偏低'
        })
      })
      resultText = `共 ${lowSpecCount} 个低库存规格，已合并为 ${rows.length} 款商品`
    } else {
      products.forEach(product => {
        product.specs.forEach(spec => {
          const isOut = Number(spec.stock) === 0
          const isLow = Number(spec.stock) <= Number(product.lowStockThreshold || 0)
          if ((this.data.mode === 'out' && !isOut) || (this.data.mode === 'low' && !isLow)) return
          rows.push({
            id: spec.id,
            productId: product.id,
            productName: product.name,
            code: product.code,
            image: product.image,
            businessType: product.businessType || 'clothing',
            businessText: product.businessType === 'cosmetics' ? '化妆品' : '服装',
            detailText: `${spec.color === '默认' ? '通用' : spec.color} / ${spec.size}`,
            stock: Number(spec.stock || 0),
            stockText: `${Number(spec.stock || 0)} 件`,
            statusText: isOut ? '已缺货' : '库存偏低'
          })
        })
      })
      rows.sort((a, b) => a.stock - b.stock)
      resultText = `共 ${rows.length} 个规格`
    }
    this.setData({ rows, resultText })
  },

  openProduct(event) {
    wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` })
  }
})
