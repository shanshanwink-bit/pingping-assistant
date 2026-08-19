const { getRecentLedgerRecords } = require('./ledger')

const GENERIC_USER_NAMES = ['店主', '微信店主', '用户']

function formatMoney(value) {
  const parts = Number(value || 0).toFixed(2).split('.')
  return `¥${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1]}`
}

function formatInteger(value) {
  return String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function greetingForHour(hour) {
  const safeHour = Number(hour)
  if (safeHour < 5) return '夜深了'
  if (safeHour < 12) return '早上好'
  if (safeHour < 14) return '中午好'
  if (safeHour < 18) return '下午好'
  return '晚上好'
}

function displayName(user) {
  const name = String(user && user.name || '').trim()
  return name && !GENERIC_USER_NAMES.includes(name) ? name : ''
}

function formatSpec(value) {
  return String(value || '').replace(/\s*\/\s*/g, ' · ')
}

function stockAlertPresentation(spec) {
  const productName = String(spec.productName || '').trim()
  const parts = String(spec.specText || '')
    .split(/\s*[\/·]\s*/)
    .map(part => part.trim())
    .filter(Boolean)
  const summarySpec = parts.some(part => /^(全部规格|汇总|聚合|SKU_SUMMARY)$/i.test(part))
  const stockStatus = Number(spec.stock) === 0 ? '已缺货' : `仅剩 ${formatInteger(spec.stock)} 件`

  if (summarySpec) {
    return { title: productName, specLabel: '', detail: `${stockStatus} · 全部规格` }
  }

  const visibleParts = parts.filter(part => !productName.includes(part))
  return {
    title: productName,
    specLabel: visibleParts.join(' · '),
    detail: stockStatus
  }
}

function localDateStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function buildStockAlerts(summary) {
  return (summary.lowSpecs || []).map(spec => {
    const presentation = stockAlertPresentation(spec)
    return {
      id: `stock-${spec.specId}`,
      productId: spec.productId,
      ...presentation,
      typeLabel: Number(spec.stock) === 0 ? '已缺货' : '库存不足',
      marker: Number(spec.stock) === 0 ? '缺' : '低',
      tone: Number(spec.stock) === 0 ? 'danger' : 'warning',
      group: Number(spec.stock) === 0 ? 0 : 1,
      priority: Number(spec.stock || 0)
    }
  })
}

function buildExpiryAlerts(products, now) {
  const today = localDateStart(now)
  return (products || []).reduce((items, product) => {
    if ((product.businessType || 'clothing') !== 'cosmetics' || !product.expiryDate) return items
    const expiry = new Date(`${product.expiryDate}T00:00:00`).getTime()
    if (!Number.isFinite(expiry)) return items
    const days = Math.ceil((expiry - today) / 86400000)
    if (days > 30) return items
    const expired = days < 0
    items.push({
      id: `expiry-${product.id}`,
      productId: product.id,
      title: product.name,
      specLabel: '',
      detail: expired
        ? '已过期'
        : days === 0 ? '今天到期' : `距离到期还有 ${formatInteger(days)} 天`,
      typeLabel: expired ? '已过期' : '即将到期',
      marker: expired ? '过' : '期',
      tone: expired ? 'danger' : 'expiry',
      group: expired ? 3 : 2,
      priority: expired ? Math.abs(days) : days
    })
    return items
  }, [])
}

function buildAllAttentionItems(summary, products, now) {
  return buildStockAlerts(summary)
    .concat(buildExpiryAlerts(products, now))
    .sort((a, b) => a.group - b.group || a.priority - b.priority || a.title.localeCompare(b.title, 'zh-CN'))
}

function buildAttentionItems(summary, products, now) {
  return buildAllAttentionItems(summary, products, now)
    .slice(0, 3)
}

function recordValue(record) {
  if (record.typeClass === 'sale' || record.typeClass === 'income') return `+${formatMoney(Math.abs(record.amount))}`
  if (record.typeClass === 'expense') return `-${formatMoney(Math.abs(record.amount))}`
  const quantity = Number(record.quantity || 0)
  if (record.typeClass === 'purchase') return `${formatInteger(Math.abs(quantity))}件`
  return `${quantity > 0 ? '+' : ''}${formatInteger(quantity)}件`
}

function buildRecentRecords(state) {
  const typeNames = { sale: '卖出', purchase: '拿货', stock: '库存调整', income: '其他收入', expense: '其他支出' }
  return getRecentLedgerRecords(state, '', 5).map(record => ({
    ...record,
    typeText: typeNames[record.typeClass] || '经营记录',
    titleText: `${record.title || typeNames[record.typeClass] || '经营记录'}${record.specText ? ` · ${formatSpec(record.specText)}` : ''}`,
    valueText: recordValue(record),
    timeText: String(record.createdAt || '').slice(5),
    tone: record.typeClass || 'stock'
  }))
}

function amountSizeClass(text) {
  if (text.length >= 15) return 'tight'
  if (text.length >= 12) return 'compact'
  return ''
}

function buildHomeDashboard(options) {
  const settings = options || {}
  const state = settings.state || {}
  const summary = settings.summary || {}
  const now = settings.now || new Date()
  const name = displayName(settings.user)
  const todaySaleAmountText = formatMoney(summary.todaySaleAmount)
  const hasTodaySales = Number(summary.todaySaleQuantity || 0) > 0
  const allAttentionItems = buildAllAttentionItems(summary, state.products || [], now)
  const attentionItems = allAttentionItems.slice(0, 3)
  return {
    greetingLine: name ? `${greetingForHour(now.getHours())}，${name}` : greetingForHour(now.getHours()),
    todaySaleAmountText,
    todayProfitText: formatMoney(settings.todayProfit),
    todaySaleQuantityText: formatInteger(summary.todaySaleQuantity),
    hasTodaySales,
    salesAmountClass: hasTodaySales ? amountSizeClass(todaySaleAmountText) : 'zero',
    productCountText: formatInteger(summary.productCount),
    totalStockText: formatInteger(summary.totalStock),
    stockValueText: formatMoney(summary.stockValue),
    attentionItems,
    recentRecords: buildRecentRecords(state),
    hasStockAlerts: allAttentionItems.some(item => item.id.startsWith('stock-')),
    hasExpiryAlerts: allAttentionItems.some(item => item.id.startsWith('expiry-'))
  }
}

module.exports = {
  buildAttentionItems,
  buildHomeDashboard,
  buildRecentRecords,
  formatInteger,
  formatMoney,
  greetingForHour
}
