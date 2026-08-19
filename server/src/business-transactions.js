class BusinessTransactionError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100
}

function safeText(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function stockOf(product) {
  return (Array.isArray(product && product.specs) ? product.specs : [])
    .reduce((sum, spec) => sum + Math.max(0, Number(spec.stock || 0)), 0)
}

function dateTimeText(date) {
  const value = date || new Date()
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

function transactionArrays(state) {
  if (!state || !Array.isArray(state.products)) throw new BusinessTransactionError(409, '服务器商品数据不可用，请先重新同步')
  state.sales = Array.isArray(state.sales) ? state.sales : []
  state.purchases = Array.isArray(state.purchases) ? state.purchases : []
  state.operations = Array.isArray(state.operations) ? state.operations : []
  state.manualProfits = Array.isArray(state.manualProfits) ? state.manualProfits : []
  return state
}

function findProductAndSpec(state, payload) {
  const productId = safeText(payload.productId)
  const specId = safeText(payload.specId)
  const product = state.products.find(item => safeText(item.id) === productId)
  if (!product) throw new BusinessTransactionError(404, '商品不存在，请返回商品页刷新')
  const specs = Array.isArray(product.specs) ? product.specs : []
  const spec = specs.find(item => safeText(item.id) === specId)
  if (!spec) throw new BusinessTransactionError(404, '商品规格不存在，请重新选择')
  return { product, spec }
}

function positiveInteger(value, label) {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new BusinessTransactionError(400, `${label}必须是大于 0 的整数`)
  }
  return quantity
}

function finiteMoney(value, label, allowZero) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new BusinessTransactionError(400, `${label}${allowZero ? '不能小于 0' : '必须大于 0'}`)
  }
  return roundMoney(amount)
}

function transactionIdentity(payload) {
  const id = safeText(payload.transactionId).slice(0, 100)
  if (!id) throw new BusinessTransactionError(400, '交易编号缺失，请重试')
  return id
}

function existingResult(state, records, transactionId) {
  const record = records.find(item => safeText(item.id) === transactionId)
  if (!record) return null
  const operation = state.operations.find(item => safeText(item.referenceId) === transactionId) || null
  return {
    duplicate: true,
    record,
    operation,
    beforeStock: Number(operation && operation.before || 0),
    afterStock: Number(operation && operation.after || 0)
  }
}

function operationFor(kind, transactionId, product, spec, quantity, before, after, createdAt, operator) {
  const sale = kind === 'sale'
  return {
    id: `op-${transactionId}`,
    type: sale ? 'outbound' : 'inbound',
    productId: product.id,
    productName: safeText(product.name) || '未命名商品',
    businessType: product.businessType || 'clothing',
    specId: spec.id,
    specText: `${safeText(spec.color) || '通用'} / ${safeText(spec.size) || '未命名规格'}`,
    quantity: sale ? -quantity : quantity,
    before,
    after,
    reason: sale ? '商品卖出' : '进货入库',
    referenceType: sale ? 'sale' : 'purchase',
    referenceId: transactionId,
    operator,
    createdAt
  }
}

function applySale(inputState, payload, now) {
  const state = transactionArrays(inputState)
  const transactionId = transactionIdentity(payload)
  const previous = existingResult(state, state.sales, transactionId)
  if (previous) return { ...previous, product: state.products.find(item => item.id === previous.record.productId), state }

  const { product, spec } = findProductAndSpec(state, payload)
  const quantity = positiveInteger(payload.quantity, '卖货数量')
  const unitPrice = finiteMoney(payload.unitPrice, '销售单价', true)
  const before = Math.max(0, Number(spec.stock || 0))
  if (before === 0) throw new BusinessTransactionError(409, '当前规格已缺货')
  if (quantity > before) throw new BusinessTransactionError(409, `库存不足，当前仅剩 ${before} 件`)

  const createdAt = dateTimeText(now)
  const after = before - quantity
  const operator = safeText(state.currentUser && state.currentUser.name) || '店主'
  const hasCost = Number(product.costPrice || 0) > 0
  const unitCost = hasCost ? roundMoney(product.costPrice) : null
  const totalAmount = roundMoney(quantity * unitPrice)
  const totalCost = hasCost ? roundMoney(quantity * unitCost) : null
  const grossProfit = hasCost ? roundMoney(totalAmount - totalCost) : null
  spec.stock = after
  if (unitPrice > 0) product.salePrice = unitPrice

  const record = {
    id: transactionId,
    productId: product.id,
    productName: safeText(product.name) || '未命名商品',
    businessType: product.businessType || 'clothing',
    specId: spec.id,
    specText: `${safeText(spec.color) || '通用'} / ${safeText(spec.size) || '未命名规格'}`,
    quantity,
    unitPrice,
    unitCost,
    totalAmount,
    totalCost,
    grossProfit,
    grossMargin: hasCost && totalAmount ? roundMoney(grossProfit / totalAmount * 100) : null,
    paymentMethod: safeText(payload.paymentMethod) || '未记录',
    note: safeText(payload.note),
    operator,
    createdAt
  }
  const operation = operationFor('sale', transactionId, product, spec, quantity, before, after, createdAt, operator)
  state.sales.unshift(record)
  state.operations.unshift(operation)
  return { duplicate: false, state, product, record, operation, beforeStock: before, afterStock: after }
}

function applyPurchase(inputState, payload, now) {
  const state = transactionArrays(inputState)
  const transactionId = transactionIdentity(payload)
  const previous = existingResult(state, state.purchases, transactionId)
  if (previous) return { ...previous, product: state.products.find(item => item.id === previous.record.productId), state }

  const { product, spec } = findProductAndSpec(state, payload)
  const quantity = positiveInteger(payload.quantity, '拿货数量')
  const unitCost = finiteMoney(payload.unitCost, '进货单价', false)
  const before = Math.max(0, Number(spec.stock || 0))
  const totalBefore = stockOf(product)
  const previousCost = Math.max(0, Number(product.costPrice || 0))
  const after = before + quantity
  const nextCost = roundMoney((totalBefore * previousCost + quantity * unitCost) / (totalBefore + quantity))
  const createdAt = dateTimeText(now)
  const operator = safeText(state.currentUser && state.currentUser.name) || '店主'
  spec.stock = after
  product.costPrice = nextCost
  if (safeText(payload.supplier)) product.supplier = safeText(payload.supplier)

  const record = {
    id: transactionId,
    productId: product.id,
    productName: safeText(product.name) || '未命名商品',
    businessType: product.businessType || 'clothing',
    specId: spec.id,
    specText: `${safeText(spec.color) || '通用'} / ${safeText(spec.size) || '未命名规格'}`,
    quantity,
    unitCost,
    totalCost: roundMoney(quantity * unitCost),
    supplier: safeText(payload.supplier),
    note: safeText(payload.note),
    operator,
    createdAt
  }
  const operation = operationFor('purchase', transactionId, product, spec, quantity, before, after, createdAt, operator)
  state.purchases.unshift(record)
  state.operations.unshift(operation)
  return { duplicate: false, state, product, record, operation, beforeStock: before, afterStock: after }
}

module.exports = {
  BusinessTransactionError,
  applyPurchase,
  applySale,
  dateTimeText,
  stockOf
}
