const {
  addDays,
  formatInteger,
  formatMoney,
  getLedgerPeriodRange,
  localDateKey,
  roundMoney,
  validDateKey
} = require('./ledger-period')

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function recordBusinessType(record, productTypes) {
  return record.businessType || productTypes[record.productId] || 'clothing'
}

function operationKey(record) {
  return [record.productId, record.specId, safeNumber(record.quantity), record.createdAt].join('|')
}

function manualCreatedAt(record) {
  const selectedDate = validDateKey(record.date) || validDateKey(record.createdAt)
  const time = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(String(record.createdAt || ''))
    ? String(record.createdAt).slice(10, 16)
    : ' 00:00'
  return selectedDate ? `${selectedDate}${time}` : ''
}

function transactionRecords(state) {
  const safeState = state || {}
  const products = safeArray(safeState.products)
  const productTypes = {}
  products.forEach(product => { productTypes[product.id] = product.businessType || 'clothing' })

  const purchaseRecords = safeArray(safeState.purchases).map(record => ({
    key: `purchase-${record.id || operationKey(record)}`,
    sourceId: record.id || '',
    businessType: recordBusinessType(record, productTypes),
    typeClass: 'purchase',
    direction: 'expense',
    typeLabel: '拿货',
    shortLabel: '拿',
    title: String(record.productName || '拿货记录'),
    specText: String(record.specText || ''),
    quantity: Math.abs(Math.round(safeNumber(record.quantity))),
    amount: -Math.abs(roundMoney(record.totalCost)),
    hasAmount: record.totalCost !== undefined && record.totalCost !== null && Number.isFinite(Number(record.totalCost)),
    note: String(record.supplier || record.note || ''),
    createdAt: String(record.createdAt || ''),
    dateKey: validDateKey(record.createdAt)
  }))

  const saleRecords = safeArray(safeState.sales).map(record => ({
    key: `sale-${record.id || operationKey(record)}`,
    sourceId: record.id || '',
    businessType: recordBusinessType(record, productTypes),
    typeClass: 'sale',
    direction: 'income',
    typeLabel: '卖货',
    shortLabel: '卖',
    title: String(record.productName || '卖货记录'),
    specText: String(record.specText || ''),
    quantity: Math.abs(Math.round(safeNumber(record.quantity))),
    amount: Math.abs(roundMoney(record.totalAmount)),
    hasAmount: record.totalAmount !== undefined && record.totalAmount !== null && Number.isFinite(Number(record.totalAmount)),
    paymentMethod: String(record.paymentMethod || ''),
    note: String(record.note || ''),
    createdAt: String(record.createdAt || ''),
    dateKey: validDateKey(record.createdAt)
  }))

  const manualRecords = safeArray(safeState.manualProfits).map(record => {
    const expense = record.entryType === 'expense' || safeNumber(record.amount) < 0
    const createdAt = manualCreatedAt(record)
    return {
      key: `cash-${record.id || `${createdAt}-${safeNumber(record.amount)}`}`,
      sourceId: record.id || '',
      businessType: record.businessType || 'clothing',
      typeClass: expense ? 'expense' : 'income',
      direction: expense ? 'expense' : 'income',
      typeLabel: expense ? '其他支出' : '其他收入',
      shortLabel: expense ? '支' : '收',
      title: String(record.note || (expense ? '其他支出' : '其他收入')),
      specText: '',
      quantity: 0,
      amount: expense ? -Math.abs(roundMoney(record.amount)) : Math.abs(roundMoney(record.amount)),
      hasAmount: record.amount !== undefined && record.amount !== null && Number.isFinite(Number(record.amount)),
      note: '',
      createdAt,
      dateKey: validDateKey(record.date) || validDateKey(record.createdAt)
    }
  })

  return purchaseRecords.concat(saleRecords, manualRecords)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.key.localeCompare(a.key))
}

function summarizeProfitRecords(records, manualRecords) {
  const sales = safeArray(records)
  const manualItems = safeArray(manualRecords)
  const pricedRecords = sales.filter(item => (
    item.totalCost !== undefined && item.totalCost !== null &&
    item.grossProfit !== undefined && item.grossProfit !== null &&
    Number.isFinite(Number(item.grossProfit))
  ))
  const revenue = roundMoney(sales.reduce((sum, item) => sum + safeNumber(item.totalAmount), 0))
  const pricedRevenue = roundMoney(pricedRecords.reduce((sum, item) => sum + safeNumber(item.totalAmount), 0))
  const cost = roundMoney(pricedRecords.reduce((sum, item) => sum + safeNumber(item.totalCost), 0))
  const salesProfit = roundMoney(pricedRecords.reduce((sum, item) => sum + safeNumber(item.grossProfit), 0))
  const manualProfit = roundMoney(manualItems.reduce((sum, item) => sum + safeNumber(item.amount), 0))
  return {
    revenue,
    cost,
    profit: roundMoney(salesProfit + manualProfit),
    salesProfit,
    manualProfit,
    margin: pricedRevenue ? roundMoney(salesProfit / pricedRevenue * 100) : 0,
    quantity: sales.reduce((sum, item) => sum + safeNumber(item.quantity), 0),
    count: sales.length,
    manualCount: manualItems.length,
    unpricedCount: sales.length - pricedRecords.length
  }
}

function recordMeta(record) {
  const parts = []
  if (record.specText) parts.push(record.specText.replace(/\s*\/\s*/g, ' · '))
  if (record.quantity) parts.push(`${formatInteger(record.quantity)}件`)
  if (record.paymentMethod && record.paymentMethod !== '未记录') parts.push(record.paymentMethod)
  if (record.note) parts.push(record.note)
  return parts.join(' · ')
}

function recordTimeText(record, now) {
  const date = record.dateKey
  const time = String(record.createdAt || '').slice(11, 16)
  if (!date) return time || '时间未记录'
  const current = now instanceof Date ? now : new Date()
  const today = localDateKey(current)
  if (date === today) return `今天${time ? ` ${time}` : ''}`
  if (date === localDateKey(addDays(current, -1))) return `昨天${time ? ` ${time}` : ''}`
  const parts = date.split('-').map(Number)
  return `${parts[1]}月${parts[2]}日${time ? ` ${time}` : ''}`
}

function buildLedgerView(state, options) {
  const settings = options || {}
  const now = settings.now instanceof Date ? settings.now : new Date()
  const range = getLedgerPeriodRange(settings.period, now)
  const flowType = ['all', 'income', 'expense'].includes(settings.flowType) ? settings.flowType : 'all'
  const safeState = state || {}
  const inPeriod = record => record.dateKey >= range.start && record.dateKey <= range.end
  const sales = safeArray(safeState.sales).filter(record => {
    const key = validDateKey(record.createdAt)
    return key >= range.start && key <= range.end
  })
  const purchases = safeArray(safeState.purchases).filter(record => {
    const key = validDateKey(record.createdAt)
    return key >= range.start && key <= range.end
  })
  const manualRecords = safeArray(safeState.manualProfits).filter(record => {
    const key = validDateKey(record.date) || validDateKey(record.createdAt)
    return key >= range.start && key <= range.end
  })
  const profitSummary = summarizeProfitRecords(sales, manualRecords)
  const otherIncome = roundMoney(manualRecords.reduce((sum, item) => (
    item.entryType !== 'expense' && safeNumber(item.amount) > 0 ? sum + safeNumber(item.amount) : sum
  ), 0))
  const otherExpense = roundMoney(manualRecords.reduce((sum, item) => (
    item.entryType === 'expense' || safeNumber(item.amount) < 0 ? sum + Math.abs(safeNumber(item.amount)) : sum
  ), 0))
  const purchaseExpense = roundMoney(purchases.reduce((sum, item) => sum + Math.abs(safeNumber(item.totalCost)), 0))
  const income = roundMoney(profitSummary.revenue + otherIncome)
  const expense = roundMoney(purchaseExpense + otherExpense)
  const allRecords = transactionRecords(safeState).filter(inPeriod)
  const records = allRecords
    .filter(record => flowType === 'all' || record.direction === flowType)
    .map(record => ({
      ...record,
      metaText: recordMeta(record),
      timeText: recordTimeText(record, now),
      amountText: record.hasAmount
        ? `${record.direction === 'income' ? '+' : '-'}${formatMoney(record.amount)}`
        : '金额未记录',
      amountClass: record.hasAmount ? record.direction : 'missing'
    }))
  const emptyTitle = allRecords.length && !records.length
    ? '当前筛选下没有经营记录'
    : `${range.label}还没有经营记录`

  return {
    range,
    flowType,
    summary: {
      ...profitSummary,
      income,
      expense,
      otherIncome,
      otherExpense,
      purchaseExpense,
      purchaseQuantity: purchases.reduce((sum, item) => sum + safeNumber(item.quantity), 0)
    },
    summaryText: {
      income: formatMoney(income),
      expense: formatMoney(expense),
      profit: `${profitSummary.profit < 0 ? '-' : ''}${formatMoney(profitSummary.profit)}`,
      saleQuantity: formatInteger(profitSummary.quantity),
      purchaseQuantity: formatInteger(purchases.reduce((sum, item) => sum + safeNumber(item.quantity), 0))
    },
    records,
    totalRecordCount: allRecords.length,
    emptyTitle,
    emptyDescription: '卖货、拿货和收支记录会显示在这里'
  }
}

function getRecentLedgerRecords(state, businessType, limit) {
  const safeState = state || {}
  const records = transactionRecords(safeState)
  const representedKeys = new Set()
  const representedReferences = new Set()
  safeArray(safeState.purchases).forEach(record => {
    representedKeys.add(operationKey(record))
    if (record.id) representedReferences.add(String(record.id))
  })
  safeArray(safeState.sales).forEach(record => {
    representedKeys.add(operationKey({ ...record, quantity: -safeNumber(record.quantity) }))
    if (record.id) representedReferences.add(String(record.id))
  })
  const productTypes = {}
  safeArray(safeState.products).forEach(product => { productTypes[product.id] = product.businessType || 'clothing' })
  const adjustments = safeArray(safeState.operations)
    .filter(record => !representedReferences.has(String(record.referenceId || '')) && !representedKeys.has(operationKey(record)))
    .map(record => ({
      key: `operation-${record.id || operationKey(record)}`,
      businessType: recordBusinessType(record, productTypes),
      typeClass: 'stock',
      shortLabel: '库',
      title: String(record.productName || '库存变化'),
      specText: String(record.specText || ''),
      quantity: safeNumber(record.quantity),
      amount: 0,
      hasAmount: false,
      note: String(record.reason || ''),
      createdAt: String(record.createdAt || '')
    }))
  return records.concat(adjustments)
    .filter(record => !businessType || record.businessType === businessType)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Number(limit) > 0 ? Number(limit) : 8)
}

module.exports = {
  buildLedgerView,
  formatMoney,
  getLedgerPeriodRange,
  getRecentLedgerRecords,
  summarizeProfitRecords
}
