const { productType, specParts, totalStock } = require('./product-display')
const { visibleSpecs } = require('./product-specs')

function text(value, fallback = '') {
  const result = String(value === undefined || value === null ? '' : value).trim()
  return result || fallback
}

function decoded(value) {
  try {
    return decodeURIComponent(text(value))
  } catch (error) {
    return text(value)
  }
}

function number(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function money(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '¥0.00'
  const sign = amount < 0 ? '-' : ''
  const parts = Math.abs(amount).toFixed(2).split('.')
  return `${sign}¥${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1]}`
}

function selectionFromQuery(options) {
  const source = options || {}
  const type = decoded(source.type)
  return {
    businessType: type === 'clothing' || type === 'cosmetics' ? type : '',
    productId: decoded(source.productId),
    specId: decoded(source.specId)
  }
}

function productIdentifier(product) {
  return text(product && product.itemNumber)
}

function productOptions(products, keyword) {
  const query = text(keyword).toLowerCase()
  return (Array.isArray(products) ? products : [])
    .filter(product => !query || [product.name, product.itemNumber]
      .some(value => text(value).toLowerCase().includes(query)))
    .map(product => ({
      id: text(product.id),
      name: text(product.name, '未命名商品'),
      identifier: productIdentifier(product),
      typeLabel: productType(product.businessType) === 'cosmetics' ? '化妆品' : '服装',
      stockText: String(totalStock(product))
    }))
}

function specOptions(product, mode) {
  return visibleSpecs(product && product.specs).map(spec => {
    const stock = Math.max(0, Math.round(number(spec.stock)))
    const parts = specParts(spec)
    return {
      id: text(spec.id),
      label: parts.label,
      displayLabel: parts.label.replace(/\s*\/\s*/g, ' · '),
      stock,
      stockText: String(stock),
      disabled: mode === 'sale' && stock === 0,
      statusText: stock === 0 ? '缺货' : `库存 ${stock}件`
    }
  })
}

function resolveProduct(products, productId) {
  const id = text(productId)
  return (Array.isArray(products) ? products : []).find(product => text(product.id) === id) || null
}

function resolveSpec(product, preferredSpecId, mode) {
  const options = specOptions(product, mode)
  const preferred = options.find(spec => spec.id === text(preferredSpecId))
  if (preferred) return preferred
  return options.length === 1 ? options[0] : null
}

function quantityError(rawQuantity) {
  if (text(rawQuantity) === '') return '请输入数量'
  const quantity = Number(rawQuantity)
  if (!Number.isFinite(quantity)) return '请输入正确数量'
  if (!Number.isInteger(quantity)) return '数量必须为整数'
  if (quantity <= 0) return '数量至少为 1'
  return ''
}

function amountError(rawAmount, mode) {
  if (text(rawAmount) === '') return mode === 'sale' ? '请输入销售单价' : '请输入进货单价'
  const amount = Number(rawAmount)
  if (!Number.isFinite(amount)) return '请输入正确金额'
  if (amount < 0 || (mode === 'purchase' && amount === 0)) {
    return mode === 'sale' ? '销售单价不能小于 0' : '进货单价必须大于 0'
  }
  return ''
}

function transactionState(settings) {
  const source = settings || {}
  const mode = source.mode === 'purchase' ? 'purchase' : 'sale'
  const product = source.product || null
  const spec = source.spec || null
  const quantityIssue = quantityError(source.quantity)
  const amountIssue = amountError(source.unitAmount, mode)
  const quantity = quantityIssue ? 0 : Number(source.quantity)
  const unitAmount = amountIssue ? 0 : Number(source.unitAmount)
  const before = Math.max(0, number(spec && spec.stock))
  let stockIssue = ''
  if (mode === 'sale' && spec) {
    if (before === 0) stockIssue = '当前规格已缺货'
    else if (!quantityIssue && quantity > before) stockIssue = `库存不足，当前仅剩 ${before} 件`
  }
  const selectionIssue = !product ? '请选择商品' : !spec ? '请选择规格' : ''
  const errorText = selectionIssue || quantityIssue || amountIssue || stockIssue
  const calculatedAfter = mode === 'sale' ? Math.max(0, before - quantity) : before + quantity
  return {
    canSubmit: !errorText,
    errorText,
    quantity,
    quantityText: quantityIssue ? '0' : String(quantity),
    unitAmount,
    unitAmountText: money(unitAmount),
    totalAmount: Math.round(quantity * unitAmount * 100) / 100,
    totalAmountText: money(quantity * unitAmount),
    beforeStock: before,
    beforeStockText: String(before),
    afterStock: quantityIssue ? before : calculatedAfter,
    afterStockText: String(quantityIssue ? before : calculatedAfter),
    productName: text(product && product.name, '未选择商品'),
    specText: spec ? text(spec.displayLabel || spec.label, '未命名规格') : '未选择规格',
    outOfStock: mode === 'sale' && Boolean(spec) && before === 0
  }
}

function stepQuantity(current, change, maximum) {
  const value = Number.isInteger(Number(current)) ? Number(current) : 1
  const next = Math.max(1, value + Number(change || 0))
  if (Number.isInteger(maximum) && maximum > 0) return Math.min(maximum, next)
  return next
}

function defaultUnitAmount(product, mode) {
  const value = mode === 'sale' ? product && product.salePrice : product && product.costPrice
  return Number(value) > 0 ? String(Number(value)) : ''
}

function transactionId(mode, now, randomValue) {
  const prefix = mode === 'purchase' ? 'purchase' : 'sale'
  const timestamp = Number(now === undefined ? Date.now() : now)
  const random = text(randomValue === undefined ? Math.random().toString(36).slice(2, 8) : randomValue, 'record')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 12)
  return `mini-${prefix}-${timestamp}-${random || 'record'}`
}

function transactionRoute(path, selection) {
  const source = selection || {}
  const params = []
  if (text(source.businessType)) params.push(`type=${encodeURIComponent(text(source.businessType))}`)
  if (text(source.productId)) params.push(`productId=${encodeURIComponent(text(source.productId))}`)
  if (text(source.specId)) params.push(`specId=${encodeURIComponent(text(source.specId))}`)
  return `${path}${params.length ? `?${params.join('&')}` : ''}`
}

function successPresentation(mode, transaction) {
  const result = transaction || {}
  const hasProfit = result.grossProfit !== null && result.grossProfit !== undefined && result.grossProfit !== '' && Number.isFinite(Number(result.grossProfit))
  return {
    title: mode === 'sale' ? '卖货成功' : '入库成功',
    productName: text(result.productName, '商品'),
    specText: text(result.specText).replace(/\s*\/\s*/g, ' · ') || '全部规格',
    quantityText: `${Math.max(0, Math.round(number(result.quantity)))}件`,
    stockChangeText: `${Math.max(0, Math.round(number(result.beforeStock)))} → ${Math.max(0, Math.round(number(result.afterStock)))}`,
    amountLabel: mode === 'sale' ? '本次销售' : '本次进货',
    amountText: money(result.totalAmount),
    profitText: mode === 'sale' && hasProfit ? money(result.grossProfit) : ''
  }
}

module.exports = {
  amountError,
  defaultUnitAmount,
  money,
  productOptions,
  quantityError,
  resolveProduct,
  resolveSpec,
  selectionFromQuery,
  specOptions,
  stepQuantity,
  successPresentation,
  transactionId,
  transactionRoute,
  transactionState
}
