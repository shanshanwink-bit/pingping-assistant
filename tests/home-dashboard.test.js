const assert = require('assert')
const { buildAttentionItems, buildHomeDashboard, buildRecentRecords, greetingForHour } = require('../utils/home-dashboard')

assert.strictEqual(greetingForHour(0), '夜深了')
assert.strictEqual(greetingForHour(4), '夜深了')
assert.strictEqual(greetingForHour(5), '早上好')
assert.strictEqual(greetingForHour(11), '早上好')
assert.strictEqual(greetingForHour(12), '中午好')
assert.strictEqual(greetingForHour(14), '下午好')
assert.strictEqual(greetingForHour(18), '晚上好')

const summary = {
  todaySaleAmount: 1286,
  todaySaleQuantity: 18,
  productCount: 86,
  totalStock: 528,
  stockValue: 23580,
  lowSpecs: [
    { specId: 'low', productId: 'p-low', productName: '白色针织衫', specText: '白色 / M', stock: 1 },
    { specId: 'empty', productId: 'p-empty', productName: '牛仔裤', specText: '蓝色 / L', stock: 0 }
  ]
}
const products = [
  { id: 'soon', businessType: 'cosmetics', name: '兰蔻粉水', expiryDate: '2026-09-05' },
  { id: 'expired', businessType: 'cosmetics', name: '旧面霜', expiryDate: '2026-08-17' }
]
const attention = buildAttentionItems(summary, products, new Date(2026, 7, 18, 10))
assert.deepStrictEqual(attention.map(item => item.id), ['stock-empty', 'stock-low', 'expiry-soon'])
assert.strictEqual(attention[0].detail, '已缺货')
assert.strictEqual(attention[0].title, '牛仔裤')
assert.strictEqual(attention[0].specLabel, '蓝色 · L')
assert.strictEqual(attention[1].detail, '仅剩 1 件')
assert.strictEqual(attention[1].specLabel, 'M')
assert.strictEqual(attention[2].detail, '距离到期还有 18 天')

const summaryAlert = buildAttentionItems({ lowSpecs: [
  { specId: 'summary', productId: 'p-summary', productName: '水100ml', specText: '全部规格 / 汇总', stock: 0 }
] }, [], new Date(2026, 7, 18, 10))[0]
assert.strictEqual(summaryAlert.title, '水100ml')
assert.strictEqual(summaryAlert.specLabel, '')
assert.strictEqual(summaryAlert.detail, '已缺货 · 全部规格')

const state = {
  products: [{ id: 'p1', businessType: 'clothing' }],
  purchases: [{ id: 'p', productId: 'p1', specId: 's1', productName: '牛仔裤', specText: '蓝色 / L', quantity: 5, totalCost: 300, createdAt: '2026-08-18 09:00' }],
  sales: [{ id: 's', productId: 'p1', specId: 's1', productName: '针织衫', specText: '白色 / M', quantity: 1, totalAmount: 129, createdAt: '2026-08-18 10:00' }],
  operations: [],
  manualProfits: [
    { id: 'income', entryType: 'income', amount: 20, note: '其他收入', createdAt: '2026-08-18 11:00' },
    { id: 'expense', entryType: 'expense', amount: -10, note: '运费', createdAt: '2026-08-18 12:00' }
  ]
}
const recent = buildRecentRecords(state)
assert.deepStrictEqual(recent.map(item => item.typeText), ['其他支出', '其他收入', '卖出', '拿货'])
assert.strictEqual(recent[2].valueText, '+¥129.00')
assert.strictEqual(recent[3].valueText, '5件')

const dashboard = buildHomeDashboard({
  state: { ...state, products }, summary, todayProfit: 436,
  user: { name: '萍萍' }, now: new Date(2026, 7, 18, 20)
})
assert.strictEqual(dashboard.greetingLine, '晚上好，萍萍')
assert.strictEqual(dashboard.todaySaleAmountText, '¥1,286.00')
assert.strictEqual(dashboard.todayProfitText, '¥436.00')
assert.strictEqual(dashboard.stockValueText, '¥23,580.00')
assert.strictEqual(dashboard.hasExpiryAlerts, true, '即使临期提醒未进入首页前三条，全部入口也应保留化妆品提醒去向')
const emptyDashboard = buildHomeDashboard({ state: {}, summary: {}, user: { name: '微信店主' }, now: new Date(2026, 7, 18, 9) })
assert.strictEqual(emptyDashboard.greetingLine, '早上好')
assert.strictEqual(emptyDashboard.salesAmountClass, 'zero')

console.log('home dashboard presentation: PASS')
