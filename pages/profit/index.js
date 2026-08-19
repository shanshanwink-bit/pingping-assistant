const ledger = require('../../utils/ledger')
const store = require('../../utils/store')

Page({
  data: {
    isLoading: true,
    loadFailed: false,
    periods: [
      { value: 'today', label: '今天' },
      { value: 'week', label: '本周' },
      { value: 'month', label: '本月' }
    ],
    flowTypes: [
      { value: 'all', label: '全部' },
      { value: 'income', label: '收入' },
      { value: 'expense', label: '支出' }
    ],
    activePeriod: 'today',
    activeFlowType: 'all',
    periodRangeText: '',
    summary: { unpricedCount: 0 },
    summaryText: {
      income: '¥0.00',
      expense: '¥0.00',
      profit: '¥0.00',
      saleQuantity: '0',
      purchaseQuantity: '0'
    },
    records: [],
    totalRecordCount: 0,
    emptyTitle: '今天还没有经营记录',
    emptyDescription: '卖货、拿货和收支记录会显示在这里'
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 2 })
    this.loadLedger()
  },

  selectPeriod(event) {
    const period = event.currentTarget.dataset.period
    if (period === this.data.activePeriod || this.data.isLoading) return
    this.setData({ activePeriod: period }, () => this.loadLedger())
  },

  selectFlowType(event) {
    const flowType = event.currentTarget.dataset.type
    if (flowType === this.data.activeFlowType || this.data.isLoading) return
    this.setData({ activeFlowType: flowType }, () => this.loadLedger())
  },

  loadLedger() {
    try {
      const view = ledger.buildLedgerView(store.getState(), {
        period: this.data.activePeriod,
        flowType: this.data.activeFlowType
      })
      this.setData({
        isLoading: false,
        loadFailed: false,
        periodRangeText: view.range.rangeText,
        summary: view.summary,
        summaryText: view.summaryText,
        records: view.records,
        totalRecordCount: view.totalRecordCount,
        emptyTitle: view.emptyTitle,
        emptyDescription: view.emptyDescription
      })
    } catch (error) {
      console.error('账本数据加载失败：', error)
      this.setData({ isLoading: false, loadFailed: true })
    }
  },

  retryLoad() {
    if (this.data.isLoading) return
    this.setData({ isLoading: true, loadFailed: false }, () => this.loadLedger())
  },

  goManualEntry() {
    if (this._navigationPending) return
    this._navigationPending = true
    wx.navigateTo({
      url: '/pages/profit-form/index?type=clothing',
      fail: error => {
        console.warn('收支补录页面打开失败：', error)
        wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
      },
      complete: () => {
        setTimeout(() => { this._navigationPending = false }, 400)
      }
    })
  }
})
