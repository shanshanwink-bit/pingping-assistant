const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    businessType: '',
    todayQuantity: 0,
    todayAmountText: '¥0.00',
    monthQuantity: 0,
    monthCount: 0,
    monthAmountText: '¥0.00',
    records: []
  },

  onLoad(options) {
    this.setData({ businessType: options.type || '' })
  },

  onShow() {
    const rawRecords = store.getPurchaseRecords(this.data.businessType || undefined)
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const month = today.slice(0, 7)
    const todayRecords = rawRecords.filter(item => String(item.createdAt || '').slice(0, 10) === today)
    const monthRecords = rawRecords.filter(item => String(item.createdAt || '').slice(0, 7) === month)
    const records = rawRecords.map(item => ({
      ...item,
      totalCostText: money(item.totalCost),
      unitCostText: money(item.unitCost),
      timeText: item.createdAt.slice(5)
    }))
    this.setData({
      todayQuantity: todayRecords.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      todayAmountText: money(todayRecords.reduce((sum, item) => sum + Number(item.totalCost || 0), 0)),
      monthQuantity: monthRecords.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      monthCount: monthRecords.length,
      monthAmountText: money(monthRecords.reduce((sum, item) => sum + Number(item.totalCost || 0), 0)),
      records
    })
  },

  addPurchase() {
    wx.navigateTo({ url: `/pages/purchase-form/index?type=${this.data.businessType || 'clothing'}` })
  },

  addProduct() {
    wx.navigateTo({ url: `/pages/product-form/index?type=${this.data.businessType || 'clothing'}` })
  }
})
