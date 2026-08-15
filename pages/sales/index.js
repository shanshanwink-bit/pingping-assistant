const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    businessType: '',
    actionText: '登记卖货',
    todayQuantity: 0,
    todayAmountText: '¥0.00',
    records: []
  },

  onLoad(options) {
    const isCosmetics = options.type === 'cosmetics'
    this.setData({
      businessType: options.type || '',
      actionText: '登记卖货'
    })
    if (isCosmetics) wx.setNavigationBarTitle({ title: '卖货记录' })
  },

  onShow() {
    const summary = store.getSummary(this.data.businessType || undefined)
    const records = store.getSaleRecords(this.data.businessType || undefined).map(item => ({
      ...item,
      totalAmountText: money(item.totalAmount),
      unitPriceText: money(item.unitPrice),
      timeText: item.createdAt.slice(5)
    }))
    this.setData({
      todayQuantity: summary.todaySaleQuantity,
      todayAmountText: money(summary.todaySaleAmount),
      records
    })
  },

  addSale() {
    wx.navigateTo({ url: `/pages/sale-form/index?type=${this.data.businessType || 'clothing'}` })
  },

  addProduct() {
    wx.navigateTo({ url: `/pages/product-form/index?type=${this.data.businessType || 'clothing'}` })
  }
})
