const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildLedgerView,
  formatMoney,
  getLedgerPeriodRange,
  getRecentLedgerRecords,
  summarizeProfitRecords
} = require('../utils/ledger')

const NOW = new Date(2026, 7, 19, 12, 0)

function stateWith(overrides) {
  return {
    products: [{ id: 'p1', businessType: 'clothing' }],
    sales: [],
    purchases: [],
    manualProfits: [],
    operations: [],
    ...(overrides || {})
  }
}

function sale(overrides) {
  return {
    id: 'sale-1', productId: 'p1', specId: 's1', productName: '水100ml',
    specText: '全部规格', quantity: 1, totalAmount: 100, totalCost: 50,
    grossProfit: 50, createdAt: '2026-08-19 10:00', ...(overrides || {})
  }
}

function purchase(overrides) {
  return {
    id: 'purchase-1', productId: 'p1', specId: 's1', productName: '水100ml',
    specText: '全部规格', quantity: 5, totalCost: 250,
    createdAt: '2026-08-19 09:00', ...(overrides || {})
  }
}

test('今日时间范围使用本地自然日', () => {
  assert.deepEqual(getLedgerPeriodRange('today', NOW), {
    period: 'today', start: '2026-08-19', end: '2026-08-19',
    label: '今天', rangeText: '2026.08.19'
  })
})

test('本周时间范围从周一开始并覆盖当前日', () => {
  const range = getLedgerPeriodRange('week', NOW)
  assert.equal(range.start, '2026-08-17')
  assert.equal(range.end, '2026-08-19')
  const sunday = getLedgerPeriodRange('week', new Date(2026, 7, 23, 23, 59))
  assert.equal(sunday.start, '2026-08-17')
  assert.equal(sunday.end, '2026-08-23')
})

test('本月时间范围从一号开始并覆盖当前日', () => {
  const range = getLedgerPeriodRange('month', new Date(2026, 7, 31, 23, 59))
  assert.equal(range.start, '2026-08-01')
  assert.equal(range.end, '2026-08-31')
})

test('销售金额计入收入', () => {
  const view = buildLedgerView(stateWith({ sales: [sale()] }), { period: 'today', now: NOW })
  assert.equal(view.summary.income, 100)
  assert.equal(view.records[0].amountText, '+¥100.00')
})

test('拿货成本计入现金支出但不直接扣减盈利', () => {
  const view = buildLedgerView(stateWith({ sales: [sale()], purchases: [purchase()] }), { period: 'today', now: NOW })
  assert.equal(view.summary.expense, 250)
  assert.equal(view.summary.profit, 50)
})

test('其他收入同时计入收入与盈利', () => {
  const manualProfits = [{ id: 'i1', entryType: 'income', amount: 30, date: '2026-08-19', createdAt: '2026-08-19 11:00' }]
  const view = buildLedgerView(stateWith({ manualProfits }), { period: 'today', now: NOW })
  assert.equal(view.summary.income, 30)
  assert.equal(view.summary.profit, 30)
})

test('其他支出同时计入支出并扣减盈利', () => {
  const manualProfits = [{ id: 'e1', entryType: 'expense', amount: -20, date: '2026-08-19', createdAt: '2026-08-19 11:00' }]
  const view = buildLedgerView(stateWith({ manualProfits }), { period: 'today', now: NOW })
  assert.equal(view.summary.expense, 20)
  assert.equal(view.summary.profit, -20)
})

test('销售记录和 outbound 操作只展示一次现金流水', () => {
  const state = stateWith({
    sales: [sale()],
    operations: [{ id: 'op-sale', referenceId: 'sale-1', type: 'outbound', productId: 'p1', specId: 's1', quantity: -1, createdAt: '2026-08-19 10:00' }]
  })
  const view = buildLedgerView(state, { period: 'today', now: NOW })
  assert.deepEqual(view.records.map(item => item.typeClass), ['sale'])
  assert.equal(view.summary.income, 100)
})

test('采购记录和 inbound 操作只展示一次现金流水', () => {
  const state = stateWith({
    purchases: [purchase()],
    operations: [{ id: 'op-purchase', referenceId: 'purchase-1', type: 'inbound', productId: 'p1', specId: 's1', quantity: 5, createdAt: '2026-08-19 09:00' }]
  })
  const view = buildLedgerView(state, { period: 'today', now: NOW })
  assert.deepEqual(view.records.map(item => item.typeClass), ['purchase'])
  assert.equal(view.summary.expense, 250)
})

test('经营流水按时间倒序', () => {
  const state = stateWith({
    sales: [sale({ createdAt: '2026-08-19 08:00' })],
    purchases: [purchase({ createdAt: '2026-08-19 09:00' })],
    manualProfits: [{ id: 'i1', amount: 10, date: '2026-08-19', createdAt: '2026-08-19 10:00' }]
  })
  const view = buildLedgerView(state, { period: 'today', now: NOW })
  assert.deepEqual(view.records.map(item => item.typeClass), ['income', 'purchase', 'sale'])
})

test('收入筛选只保留销售和其他收入', () => {
  const state = stateWith({
    sales: [sale()], purchases: [purchase()],
    manualProfits: [{ id: 'i1', amount: 10, date: '2026-08-19', createdAt: '2026-08-19 11:00' }]
  })
  const view = buildLedgerView(state, { period: 'today', flowType: 'income', now: NOW })
  assert.deepEqual(view.records.map(item => item.direction), ['income', 'income'])
})

test('支出筛选只保留拿货和其他支出', () => {
  const state = stateWith({
    sales: [sale()], purchases: [purchase()],
    manualProfits: [{ id: 'e1', entryType: 'expense', amount: -10, date: '2026-08-19', createdAt: '2026-08-19 11:00' }]
  })
  const view = buildLedgerView(state, { period: 'today', flowType: 'expense', now: NOW })
  assert.deepEqual(view.records.map(item => item.direction), ['expense', 'expense'])
})

test('空账本返回自然空状态', () => {
  const view = buildLedgerView(stateWith(), { period: 'today', now: NOW })
  assert.equal(view.emptyTitle, '今天还没有经营记录')
  assert.equal(view.records.length, 0)
  assert.equal(view.summaryText.income, '¥0.00')
})

test('金额统一四舍五入并显示两位小数', () => {
  assert.equal(formatMoney(99.999999), '¥100.00')
  assert.equal(formatMoney(12345.6), '¥12,345.60')
})

test('缺失字段不会产生 undefined 或 NaN', () => {
  const view = buildLedgerView(stateWith({ sales: [{ id: 'broken', createdAt: '2026-08-19 08:00' }] }), { period: 'today', now: NOW })
  const output = JSON.stringify(view)
  assert.equal(output.includes('undefined'), false)
  assert.equal(output.includes('NaN'), false)
  assert.equal(view.records[0].title, '卖货记录')
  assert.equal(view.records[0].amountText, '金额未记录')
})

test('00:00 和 23:59 都属于当天边界', () => {
  const state = stateWith({ sales: [
    sale({ id: 'start', totalAmount: 10, grossProfit: 5, createdAt: '2026-08-19 00:00' }),
    sale({ id: 'end', totalAmount: 20, grossProfit: 10, createdAt: '2026-08-19 23:59' }),
    sale({ id: 'outside', totalAmount: 40, grossProfit: 20, createdAt: '2026-08-18 23:59' })
  ] })
  const view = buildLedgerView(state, { period: 'today', now: NOW })
  assert.equal(view.summary.income, 30)
  assert.equal(view.records.length, 2)
})

test('首页销售额与账本销售来源保持一致', () => {
  const sales = [sale({ totalAmount: 129 })]
  const shared = summarizeProfitRecords(sales, [])
  const ledgerView = buildLedgerView(stateWith({ sales }), { period: 'today', now: NOW })
  assert.equal(ledgerView.summary.income, shared.revenue)
})

test('首页和账本共享销售毛利加其他收支口径', () => {
  const sales = [sale({ grossProfit: 50 })]
  const manual = [
    { id: 'i1', amount: 20, entryType: 'income', date: '2026-08-19', createdAt: '2026-08-19 11:00' },
    { id: 'e1', amount: -10, entryType: 'expense', date: '2026-08-19', createdAt: '2026-08-19 11:30' }
  ]
  const shared = summarizeProfitRecords(sales, manual)
  const ledgerView = buildLedgerView(stateWith({ sales, manualProfits: manual }), { period: 'today', now: NOW })
  assert.equal(shared.profit, 60)
  assert.equal(ledgerView.summary.profit, shared.profit)
})

test('封版经营口径同时覆盖销售、拿货和其他收支', () => {
  const manual = [
    { id: 'income-100', amount: 100, entryType: 'income', date: '2026-08-19', createdAt: '2026-08-19 11:00' },
    { id: 'expense-30', amount: -30, entryType: 'expense', date: '2026-08-19', createdAt: '2026-08-19 11:30' }
  ]
  const view = buildLedgerView(stateWith({
    sales: [sale({ totalAmount: 100, totalCost: 50, grossProfit: 50 })],
    purchases: [purchase({ quantity: 5, totalCost: 250 })],
    manualProfits: manual
  }), { period: 'today', now: NOW })

  assert.equal(view.summary.income, 200)
  assert.equal(view.summary.expense, 280)
  assert.equal(view.summary.profit, 120)
})

test('缺少销售成本时收入计入但不伪造毛利', () => {
  const view = buildLedgerView(stateWith({
    sales: [sale({ totalAmount: 100, totalCost: undefined, grossProfit: undefined })]
  }), { period: 'today', now: NOW })

  assert.equal(view.summary.income, 100)
  assert.equal(view.summary.profit, 0)
})

test('首页近期记录仍保留纯库存调整但去除交易操作重复项', () => {
  const state = stateWith({
    sales: [sale()],
    operations: [
      { id: 'sale-op', referenceId: 'sale-1', type: 'outbound', productId: 'p1', specId: 's1', quantity: -1, createdAt: '2026-08-19 10:00' },
      { id: 'stock-op', type: 'stocktake', productId: 'p1', specId: 's1', productName: '水100ml', quantity: 2, createdAt: '2026-08-19 12:00' }
    ]
  })
  const records = getRecentLedgerRecords(state, '', 8)
  assert.deepEqual(records.map(item => item.key), ['operation-stock-op', 'sale-sale-1'])
})
