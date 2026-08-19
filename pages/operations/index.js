const store = require('../../utils/store')

Page({
  data: {
    businessType: '',
    recordMode: false,
    pageTitle: '出入库',
    filters: [
      { value: 'all', label: '全部' },
      { value: 'inbound', label: '入库' },
      { value: 'outbound', label: '出库' },
      { value: 'stocktake', label: '盘点' }
    ],
    activeFilter: 'all',
    operations: [],
    filteredOperations: []
  },

  onLoad(options) {
    const recordMode = options.mode === 'stock-records'
    const profileMode = options.source === 'profile'
    const pageTitle = recordMode ? '库存记录' : profileMode ? '操作记录' : '出入库'
    this.setData({
      businessType: options.type || '',
      recordMode,
      pageTitle
    })
    if (recordMode || profileMode) wx.setNavigationBarTitle({ title: pageTitle })
  },

  onShow() {
    const state = store.getState()
    const productMap = {}
    state.products.forEach(product => { productMap[product.id] = product.businessType || 'clothing' })
    const typeMap = { inbound: '入库', outbound: '出库', stocktake: this.data.recordMode ? '库存' : '盘点' }
    const operations = state.operations.filter(item => {
      const matchesBusiness = !this.data.businessType || (item.businessType || productMap[item.productId] || 'clothing') === this.data.businessType
      return matchesBusiness
    }).map(item => {
      let typeText = typeMap[item.type] || '调整'
      let typeClass = item.type
      if (this.data.recordMode) {
        if (item.type === 'inbound' || item.reason === '库存增加') {
          typeText = '增加'
          typeClass = 'inbound'
        } else if (item.type === 'outbound' && /售出|卖出/.test(String(item.reason || ''))) {
          typeText = '卖出'
          typeClass = 'outbound'
        } else if (item.type === 'outbound') {
          typeText = '减少'
          typeClass = 'outbound'
        } else if (String(item.reason || '').includes('新建商品')) {
          typeText = '初始'
          typeClass = 'initial'
        } else {
          typeText = '修改'
          typeClass = 'stocktake'
        }
      }
      return {
        ...item,
        typeText,
        typeClass,
        displayReason: String(item.reason || '').replace(/售出/g, '卖出'),
        stockFlowText: `${Number(item.before || 0)} → ${Number(item.after || 0)}`,
        quantityText: item.quantity > 0 ? `+${item.quantity}` : String(item.quantity),
        dateText: item.createdAt.slice(5)
      }
    })
    this.setData({ operations }, () => this.applyFilter())
  },

  selectFilter(event) {
    this.setData({ activeFilter: event.currentTarget.dataset.value }, () => this.applyFilter())
  },

  applyFilter() {
    const filter = this.data.activeFilter
    const filteredOperations = filter === 'all' ? this.data.operations : this.data.operations.filter(item => item.type === filter)
    this.setData({ filteredOperations })
  }
})
