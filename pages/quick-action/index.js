const store = require('../../utils/store')

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

Page({
  data: {
    todaySaleText: '¥0.00',
    todayProfitText: '¥0.00',
    todaySaleQuantity: 0
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 2 })
    const summary = store.getSummary()
    const clothingProfit = store.getProfitAnalysis({ businessType: 'clothing', period: 'today' }).summary.profit
    const cosmeticsProfit = store.getProfitAnalysis({ businessType: 'cosmetics', period: 'today' }).summary.profit
    this.setData({
      todaySaleText: money(summary.todaySaleAmount),
      todayProfitText: money(clothingProfit + cosmeticsProfit),
      todaySaleQuantity: summary.todaySaleQuantity
    })
  },

  addStock() {
    wx.showActionSheet({
      itemList: ['服装 · 拿货', '化妆品 · 增加库存'],
      success: result => {
        const url = result.tapIndex === 0
          ? '/pages/purchase-form/index?type=clothing'
          : '/pages/stock-form/index?type=stocktake&businessType=cosmetics&mode=save'
        wx.navigateTo({ url })
      }
    })
  },

  addSale() {
    wx.showActionSheet({
      itemList: ['卖出服装', '卖出化妆品'],
      success: result => {
        const type = result.tapIndex === 0 ? 'clothing' : 'cosmetics'
        wx.navigateTo({ url: `/pages/sale-form/index?type=${type}` })
      }
    })
  },

  addIncomeExpense() {
    wx.navigateTo({ url: '/pages/profit-form/index?type=clothing' })
  },

  openRecords() {
    wx.navigateTo({ url: '/pages/operations/index' })
  }
})
