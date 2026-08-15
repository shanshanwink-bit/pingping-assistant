const store = require('../../utils/store')

function todayText() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function entryPresentation(type, amount) {
  const expense = type === 'expense'
  const number = Number(amount)
  return {
    submitText: expense ? '记一笔支出' : '记一笔收入',
    notePresets: expense ? ['运费', '包装耗材', '退货损失', '其他支出'] : ['线下销售', '其他收入'],
    amountPreview: `${expense ? '-' : '+'}¥${Number.isFinite(number) && number > 0 ? number.toFixed(2) : '0.00'}`
  }
}

Page({
  data: {
    businessTabs: [
      { value: 'clothing', label: '服装' },
      { value: 'cosmetics', label: '化妆品' }
    ],
    businessType: 'clothing',
    businessTitle: '服装',
    entryType: 'income',
    submitText: '记一笔收入',
    notePresets: ['线下销售', '其他收入'],
    amountPreview: '+¥0.00',
    todayDate: todayText(),
    date: todayText(),
    amount: '',
    note: '',
    saving: false
  },

  onLoad(options) {
    const businessType = options.type === 'cosmetics' ? 'cosmetics' : 'clothing'
    this.setData({
      businessType,
      businessTitle: businessType === 'cosmetics' ? '化妆品' : '服装'
    })
  },

  selectEntryType(event) {
    const entryType = event.currentTarget.dataset.type === 'expense' ? 'expense' : 'income'
    this.setData({ entryType, note: '', ...entryPresentation(entryType, this.data.amount) })
  },

  selectBusiness(event) {
    const businessType = event.currentTarget.dataset.type
    this.setData({
      businessType,
      businessTitle: businessType === 'cosmetics' ? '化妆品' : '服装'
    })
  },

  selectDate(event) {
    this.setData({ date: event.detail.value })
  },

  selectNotePreset(event) {
    this.setData({ note: event.currentTarget.dataset.note })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    if (field === 'amount') {
      this.setData({ amount: value, ...entryPresentation(this.data.entryType, value) })
      return
    }
    this.setData({ [field]: value })
  },

  submit() {
    if (this.data.saving) return
    const enteredAmount = Number(this.data.amount)
    if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) {
      wx.showToast({ title: '请输入大于 0 的金额', icon: 'none' })
      return
    }
    const amount = this.data.entryType === 'expense' ? -enteredAmount : enteredAmount
    try {
      this.setData({ saving: true })
      store.addManualProfit({
        businessType: this.data.businessType,
        entryType: this.data.entryType,
        date: this.data.date,
        amount,
        note: this.data.note
      })
      wx.showToast({ title: this.data.entryType === 'expense' ? '支出已补录' : '收入已补录', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      this.setData({ saving: false })
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
