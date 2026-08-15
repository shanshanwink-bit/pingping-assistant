const store = require('../../utils/store')

function money(value) {
  const number = Number(value || 0)
  const sign = number < 0 ? '-' : ''
  return `${sign}¥${Math.abs(number).toFixed(2)}`
}

function todayText() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

Page({
  data: {
    businessTabs: [
      { value: 'clothing', label: '服装', icon: '/assets/icons/brand-water-hanger.svg' },
      { value: 'cosmetics', label: '化妆品', icon: '/assets/icons/tab-cosmetics-active.svg' }
    ],
    activeBusinessType: 'clothing',
    businessTitle: '服装',
    businessDescription: '服装销售与商品毛利',
    businessIcon: '/assets/icons/brand-water-hanger.svg',
    periods: [
      { value: 'today', label: '今日' },
      { value: 'yesterday', label: '昨日' },
      { value: 'month', label: '本月' },
      { value: 'lastMonth', label: '上月' }
    ],
    trendRanges: [
      { value: '7days', label: '7天' },
      { value: '30days', label: '30天' },
      { value: '12months', label: '12个月' }
    ],
    rankingTabs: [
      { value: 'profit', label: '盈利最高' },
      { value: 'quantity', label: '销量最高' },
      { value: 'margin', label: '毛利率最高' },
      { value: 'loss', label: '亏损商品' }
    ],
    activePeriod: 'month',
    activeTrend: '7days',
    activeRanking: 'profit',
    showDetails: false,
    todayDate: todayText(),
    customDate: todayText(),
    customDateLabel: todayText().slice(5),
    periodTitle: '本月盈利',
    summary: { revenue: 0, cost: 0, profit: 0, margin: 0, quantity: 0, count: 0, unpricedCount: 0 },
    revenueText: '¥0.00',
    costText: '¥0.00',
    profitText: '¥0.00',
    manualProfitText: '¥0.00',
    salesProfitText: '¥0.00',
    averageProfitText: '¥0.00',
    averageOrderText: '¥0.00',
    costRateText: '0%',
    costRateWidth: 0,
    marginWidth: 0,
    periodRangeText: '',
    healthText: '暂无销售数据',
    healthClass: 'neutral',
    comparisonText: '暂无可比数据',
    comparisonClass: 'neutral',
    trend: [],
    selectedTrend: { label: '', revenueText: '¥0.00', profitText: '¥0.00' },
    dailyRows: [],
    productStats: [],
    rankingProducts: [],
    rankingEmptyText: '还没有商品盈利数据',
    paymentMethods: [],
    manualProfits: []
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ selected: 3 })
    this.loadAnalysis()
  },

  selectPeriod(event) {
    this.setData({ activePeriod: event.currentTarget.dataset.period }, () => this.loadAnalysis())
  },

  selectBusiness(event) {
    const activeBusinessType = event.currentTarget.dataset.type
    this.setData({
      activeBusinessType,
      businessTitle: activeBusinessType === 'cosmetics' ? '化妆品' : '服装',
      businessDescription: activeBusinessType === 'cosmetics' ? '化妆品销售与商品毛利' : '服装销售与商品毛利',
      businessIcon: activeBusinessType === 'cosmetics' ? '/assets/icons/tab-cosmetics-active.svg' : '/assets/icons/brand-water-hanger.svg'
    }, () => this.loadAnalysis())
  },

  selectCustomDate(event) {
    this.setData({ activePeriod: 'custom', customDate: event.detail.value, customDateLabel: event.detail.value.slice(5) }, () => this.loadAnalysis())
  },

  selectTrend(event) {
    this.setData({ activeTrend: event.currentTarget.dataset.range }, () => this.loadAnalysis())
  },

  selectRanking(event) {
    this.setData({ activeRanking: event.currentTarget.dataset.ranking }, () => this.applyRanking())
  },

  toggleDetails() {
    const showDetails = !this.data.showDetails
    this.setData({ showDetails }, () => {
      if (showDetails) this.drawTrend(Math.max(0, this.data.trend.length - 1))
    })
  },

  loadAnalysis() {
    const analysis = store.getProfitAnalysis({
      businessType: this.data.activeBusinessType,
      period: this.data.activePeriod,
      customDate: this.data.customDate,
      trendRange: this.data.activeTrend
    })
    const titleMap = { today: '今日盈利', yesterday: '昨日盈利', month: '本月盈利', lastMonth: '上月盈利', custom: `${this.data.customDate.slice(5).replace('-', '月')}日盈利` }
    const previousMap = { today: '昨日', yesterday: '前日', month: '上月同期', lastMonth: '前一个月', custom: '前一日' }
    const change = analysis.comparison.amount
    let comparisonText = '暂无可比数据'
    let comparisonClass = 'neutral'
    if (analysis.comparison.percent !== null) {
      const action = change >= 0 ? '增加' : '减少'
      comparisonText = `比${previousMap[this.data.activePeriod]}${action} ${money(Math.abs(change))}（${Math.abs(analysis.comparison.percent)}%）`
      comparisonClass = change >= 0 ? 'gain' : 'loss'
    } else if (analysis.summary.profit !== 0) {
      comparisonText = `${previousMap[this.data.activePeriod]}暂无盈利数据`
    }
    const dailyRows = analysis.dailyRows.map(item => ({
      ...item,
      dateText: item.date.slice(5).replace('-', '月') + '日',
      revenueText: money(item.revenue),
      costText: money(item.cost),
      profitText: money(item.profit),
      manualProfitText: money(item.manualProfit),
      profitClass: item.profit < 0 ? 'loss' : 'gain'
    }))
    const paymentMethods = analysis.paymentMethods.map((item, index) => ({
      ...item,
      amountText: money(item.amount),
      percentText: `${item.percent}%`,
      barWidth: item.percent ? Math.max(item.percent, 4) : 0,
      tone: index % 4
    }))
    const lastTrend = analysis.trend[analysis.trend.length - 1] || { label: '', revenue: 0, profit: 0 }
    const manualProfits = analysis.manualProfits.map(item => ({
      ...item,
      dateText: item.date.slice(5).replace('-', '月') + '日',
      amountText: money(item.amount),
      amountClass: item.amount < 0 ? 'loss' : 'gain'
    }))
    const averageProfit = analysis.summary.quantity
      ? analysis.summary.salesProfit / analysis.summary.quantity
      : 0
    const averageOrder = analysis.summary.count
      ? analysis.summary.revenue / analysis.summary.count
      : 0
    const costRate = analysis.summary.revenue
      ? analysis.summary.cost / analysis.summary.revenue * 100
      : 0
    const marginWidth = Math.max(0, Math.min(Number(analysis.summary.margin || 0), 100))
    const costRateWidth = Math.max(0, Math.min(Number(costRate || 0), 100))
    const healthText = analysis.summary.revenue === 0
      ? '暂无销售数据'
      : analysis.summary.profit < 0
        ? '当前有亏损'
        : analysis.summary.margin >= 40
          ? '盈利表现良好'
          : '经营保持盈利'
    const healthClass = analysis.summary.revenue === 0
      ? 'neutral'
      : analysis.summary.profit < 0 ? 'loss' : 'gain'
    this.setData({
      periodTitle: `${this.data.businessTitle} · ${titleMap[this.data.activePeriod]}`,
      periodRangeText: analysis.start === analysis.end
        ? analysis.start.replace(/-/g, '.')
        : `${analysis.start.replace(/-/g, '.')} - ${analysis.end.replace(/-/g, '.')}`,
      summary: analysis.summary,
      revenueText: money(analysis.summary.revenue),
      costText: money(analysis.summary.cost),
      profitText: money(analysis.summary.profit),
      manualProfitText: money(analysis.summary.manualProfit),
      salesProfitText: money(analysis.summary.salesProfit),
      averageProfitText: money(averageProfit),
      averageOrderText: money(averageOrder),
      costRateText: `${costRate.toFixed(1)}%`,
      costRateWidth,
      marginWidth,
      healthText,
      healthClass,
      comparisonText,
      comparisonClass,
      trend: analysis.trend,
      selectedTrend: { label: lastTrend.label, revenueText: money(lastTrend.revenue), profitText: money(lastTrend.profit) },
      dailyRows,
      productStats: analysis.productStats,
      paymentMethods,
      manualProfits
    }, () => {
      this.applyRanking()
      this.drawTrend(analysis.trend.length - 1)
    })
  },

  goManualProfit() {
    wx.navigateTo({ url: `/pages/profit-form/index?type=${this.data.activeBusinessType}` })
  },

  openStockLedger() {
    const url = this.data.activeBusinessType === 'clothing'
      ? '/pages/purchases/index?type=clothing'
      : '/pages/operations/index?type=cosmetics&mode=stock-records'
    wx.navigateTo({ url })
  },

  openSaleLedger() {
    wx.navigateTo({ url: `/pages/sales/index?type=${this.data.activeBusinessType}` })
  },

  openAllChanges() {
    wx.navigateTo({ url: `/pages/operations/index?type=${this.data.activeBusinessType}` })
  },

  deleteManualProfit(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条补录记录？',
      content: '删除后，相关日期的盈利汇总和折线图会自动更新。',
      confirmColor: '#c94f7f',
      success: result => {
        if (!result.confirm) return
        try {
          store.removeManualProfit(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadAnalysis()
        } catch (error) {
          wx.showToast({ title: error.message, icon: 'none' })
        }
      }
    })
  },

  applyRanking() {
    const mode = this.data.activeRanking
    let products = this.data.productStats.filter(item => item.count > item.unpricedCount)
    if (mode === 'quantity') products = this.data.productStats.slice().sort((a, b) => b.quantity - a.quantity)
    else if (mode === 'margin') products = products.sort((a, b) => b.margin - a.margin)
    else if (mode === 'loss') products = products.filter(item => item.profit < 0).sort((a, b) => a.profit - b.profit)
    else products = products.sort((a, b) => b.profit - a.profit)
    const emptyMap = {
      profit: '还没有商品盈利数据',
      quantity: '还没有商品销量数据',
      margin: '还没有可计算的毛利率',
      loss: '当前没有亏损商品'
    }
    const rankingProducts = products.slice(0, 5).map((item, index) => ({
      ...item,
      rank: index + 1,
      revenueText: money(item.revenue),
      profitText: money(item.profit),
      marginText: `${item.margin}%`,
      mainValue: mode === 'quantity' ? `${item.quantity} 件` : mode === 'margin' ? `${item.margin}%` : money(item.profit),
      valueClass: item.profit < 0 ? 'loss' : 'gain'
    }))
    this.setData({ rankingProducts, rankingEmptyText: emptyMap[mode] })
  },

  drawTrend(selectedIndex) {
    wx.createSelectorQuery()
      .in(this)
      .select('.profit-chart')
      .boundingClientRect(rect => {
        if (!rect || !rect.width) return
        this.chartRect = rect
        this.paintChart(rect.width, rect.height, selectedIndex)
      })
      .exec()
  },

  selectChartPoint(event) {
    const data = this.data.trend
    if (!data.length || !this.chartRect) return
    const touch = event.touches && event.touches[0]
    const rawX = event.detail && event.detail.x !== undefined ? event.detail.x : touch ? touch.x : 0
    const paddingLeft = 28
    const paddingRight = 18
    const chartWidth = this.chartRect.width - paddingLeft - paddingRight
    const index = Math.max(0, Math.min(data.length - 1, Math.round((rawX - paddingLeft) / chartWidth * (data.length - 1))))
    const item = data[index]
    this.setData({ selectedTrend: { label: item.label, revenueText: money(item.revenue), profitText: money(item.profit) } }, () => this.drawTrend(index))
  },

  paintChart(width, height, selectedIndex) {
    const data = this.data.trend
    if (!data.length) return
    const context = wx.createCanvasContext('profitTrend', this)
    const padding = { left: 28, right: 18, top: 24, bottom: 34 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    const values = []
    data.forEach(item => values.push(Number(item.revenue || 0), Number(item.profit || 0)))
    let maxValue = Math.max(...values, 0)
    let minValue = Math.min(...values, 0)
    if (maxValue === minValue) {
      maxValue += 1
      minValue -= 1
    }
    const range = maxValue - minValue
    const pointX = index => padding.left + chartWidth * index / Math.max(data.length - 1, 1)
    const pointY = value => padding.top + (maxValue - value) / range * chartHeight

    context.setStrokeStyle('#dbeaf3')
    context.setLineWidth(1)
    ;[0, 0.5, 1].forEach(rate => {
      const y = padding.top + chartHeight * rate
      context.beginPath()
      context.moveTo(padding.left, y)
      context.lineTo(width - padding.right, y)
      context.stroke()
    })

    const drawLine = (field, color) => {
      context.beginPath()
      data.forEach((item, index) => {
        const x = pointX(index)
        const y = pointY(item[field])
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.setStrokeStyle(color)
      context.setLineWidth(3)
      context.setLineJoin('round')
      context.setLineCap('round')
      context.stroke()
    }
    drawLine('revenue', '#eb82aa')
    drawLine('profit', '#65acd7')

    const labelStep = data.length <= 7 ? 1 : data.length <= 12 ? 2 : 5
    data.forEach((item, index) => {
      if (index % labelStep !== 0 && index !== data.length - 1) return
      context.setFillStyle('#9a858e')
      context.setFontSize(10)
      context.setTextAlign('center')
      context.fillText(item.label, pointX(index), height - 10)
    })

    if (selectedIndex >= 0 && data[selectedIndex]) {
      const x = pointX(selectedIndex)
      context.setStrokeStyle('#c8dce8')
      context.setLineWidth(1)
      context.beginPath()
      context.moveTo(x, padding.top)
      context.lineTo(x, padding.top + chartHeight)
      context.stroke()
      ;[['revenue', '#eb82aa'], ['profit', '#65acd7']].forEach(([field, color]) => {
        context.beginPath()
        context.arc(x, pointY(data[selectedIndex][field]), 5, 0, Math.PI * 2)
        context.setFillStyle(color)
        context.fill()
      })
    }
    context.draw()
  }
})
