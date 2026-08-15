const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navSpacerHeight: 64,
    dateText: '',
    greeting: '',
    stockValueText: '¥0',
    todaySaleAmountText: '¥0.00',
    todayProfitText: '¥0.00',
    businessCards: [],
    attentionItems: [],
    categoryStats: [],
    summary: {
      totalStock: 0,
      productCount: 0,
      lowSpecs: [],
      outOfStockCount: 0,
      recentOperations: []
    },
    lowPreview: [],
    recentOperations: []
  },

  onLoad() {
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = Number(windowInfo.statusBarHeight || 20)
      const navBarHeight = menuRect && menuRect.top
        ? (menuRect.top - statusBarHeight) * 2 + menuRect.height
        : 44
      this.setData({
        statusBarHeight,
        navBarHeight,
        navSpacerHeight: statusBarHeight + navBarHeight
      })
    } catch (error) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44, navSpacerHeight: 64 })
    }
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 0 })
    const date = new Date()
    const summary = store.getSummary()
    const clothingSummary = store.getSummary('clothing')
    const cosmeticSummary = store.getSummary('cosmetics')
    const clothingProfit = store.getProfitAnalysis({ businessType: 'clothing', period: 'today' }).summary.profit
    const cosmeticProfit = store.getProfitAnalysis({ businessType: 'cosmetics', period: 'today' }).summary.profit
    const recentOperations = summary.recentOperations.slice(0, 3).map(item => this.formatOperation(item))
    const businessCards = [
      {
        type: 'clothing',
        title: '服装',
        icon: '/assets/icons/brand-water-hanger.svg',
        stock: clothingSummary.totalStock,
        costText: `¥${this.formatMoney(clothingSummary.stockValue)}`,
        productCount: clothingSummary.productCount,
        todaySale: clothingSummary.todaySaleQuantity
      },
      {
        type: 'cosmetics',
        title: '化妆品',
        icon: '/assets/icons/tab-cosmetics-active.svg',
        stock: cosmeticSummary.totalStock,
        costText: `¥${this.formatMoney(cosmeticSummary.stockValue)}`,
        productCount: cosmeticSummary.productCount,
        todaySale: cosmeticSummary.todaySaleQuantity
      }
    ]
    const attentionItems = this.buildAttentionItems(summary)
    const hour = date.getHours()
    const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
    const categoryStats = summary.categoryStats.map((item, index) => ({ ...item, tone: index % 4 }))
    this.setData({
      dateText: `${date.getMonth() + 1}月${date.getDate()}日`,
      greeting,
      stockValueText: `¥${this.formatMoney(summary.stockValue)}`,
      todaySaleAmountText: `¥${Number(summary.todaySaleAmount || 0).toFixed(2)}`,
      todayProfitText: `¥${Number(clothingProfit + cosmeticProfit).toFixed(2)}`,
      businessCards,
      attentionItems,
      categoryStats,
      summary,
      lowPreview: summary.lowSpecs.slice(0, 3),
      recentOperations
    })
  },

  formatOperation(item) {
    const typeMap = { inbound: '入库', outbound: '出库', stocktake: '盘点' }
    const badgeMap = { inbound: '入', outbound: '出', stocktake: '盘' }
    const product = store.getProduct(item.productId)
    return {
      ...item,
      image: product ? product.image : '',
      businessType: product ? product.businessType || 'clothing' : 'clothing',
      businessText: product && product.businessType === 'cosmetics' ? '化妆品' : '服装',
      placeholderIcon: product && product.businessType === 'cosmetics' ? '/assets/icons/tab-cosmetics-active.svg' : '/assets/icons/shirt-blue.svg',
      typeText: typeMap[item.type] || '调整',
      badgeText: badgeMap[item.type] || '调',
      quantityText: item.quantity > 0 ? `+${item.quantity}` : String(item.quantity),
      timeText: item.createdAt.slice(5)
    }
  },

  buildAttentionItems(summary) {
    const items = []
    const seen = {}
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    store.getProducts('cosmetics').forEach(product => {
      if (!product.expiryDate) return
      const expiry = new Date(`${product.expiryDate}T00:00:00`).getTime()
      if (!Number.isFinite(expiry)) return
      const days = Math.ceil((expiry - today) / 86400000)
      if (days > 30) return
      items.push({
        id: `expiry-${product.id}`,
        productId: product.id,
        image: product.image,
        icon: '/assets/icons/tab-cosmetics-active.svg',
        title: product.name,
        detail: product.expiryDate,
        statusText: days < 0 ? `已过期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${days} 天后到期`,
        tone: days <= 0 ? 'danger' : 'expiry',
        priority: days
      })
      seen[product.id] = true
    })
    items.sort((a, b) => a.priority - b.priority)
    summary.lowSpecs.forEach(spec => {
      if (items.length >= 3 || seen[spec.productId]) return
      const product = store.getProduct(spec.productId)
      if (!product) return
      items.push({
        id: `stock-${spec.specId}`,
        productId: spec.productId,
        image: product.image,
        icon: product.businessType === 'cosmetics' ? '/assets/icons/tab-cosmetics-active.svg' : '/assets/icons/shirt-blue.svg',
        title: spec.productName,
        detail: spec.specText,
        statusText: spec.stock === 0 ? '已缺货' : `仅剩 ${spec.stock} 件`,
        tone: spec.stock === 0 ? 'danger' : 'stock',
        priority: 100 + spec.stock
      })
      seen[spec.productId] = true
    })
    return items.slice(0, 3)
  },

  formatNumber(value) {
    const rounded = Math.round(Number(value || 0))
    return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  },

  formatMoney(value) {
    const parts = Number(value || 0).toFixed(2).split('.')
    return `${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1]}`
  },

  goInventory() {
    wx.switchTab({ url: '/pages/inventory/index' })
  },

  goBusiness(event) {
    const type = event.currentTarget.dataset.type
    wx.setStorageSync('product_business_filter', type)
    wx.switchTab({ url: '/pages/inventory/index' })
  },

  openAttention(event) {
    wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  openRecent(event) {
    wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  goStockOverview(event) {
    wx.navigateTo({ url: `/pages/stock-overview/index?mode=${event.currentTarget.dataset.mode}` })
  },

  goOperations() {
    wx.navigateTo({ url: '/pages/operations/index' })
  },

  goPurchase() {
    wx.showActionSheet({
      itemList: ['服装 · 登记拿货', '化妆品 · 增加库存'],
      success: result => {
        const url = result.tapIndex === 0
          ? '/pages/purchase-form/index?type=clothing'
          : '/pages/stock-form/index?type=stocktake&businessType=cosmetics&mode=save'
        wx.navigateTo({ url })
      }
    })
  },

  goSale() {
    wx.showActionSheet({
      itemList: ['卖出服装', '卖出化妆品'],
      success: result => {
        const businessType = result.tapIndex === 0 ? 'clothing' : 'cosmetics'
        wx.navigateTo({ url: `/pages/sale-form/index?type=${businessType}` })
      }
    })
  }
})
