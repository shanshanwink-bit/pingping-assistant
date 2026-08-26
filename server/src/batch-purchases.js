const crypto = require('node:crypto')
const { applyPurchase, stockOf } = require('./business-transactions')
const { isProductActiveStatus } = require('./product-status')

const MAX_BATCH_ITEMS = 20
const MAX_BATCH_ID_LENGTH = 64
const MAX_LINE_ID_LENGTH = 24

class BatchPurchaseError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.statusCode = statusCode
    this.details = code ? { code } : undefined
  }
}

async function assertBatchProductsActive(connection, state, membership, batch) {
  for (const item of batch.items) {
    const product = state.products.find(candidate => text(candidate && candidate.id) === item.productId)
    if (!product) continue
    if (!isProductActiveStatus(product.status)) {
      throw new BatchPurchaseError(409, '商品已停用，请先重新启用', 'PRODUCT_INACTIVE')
    }
    const adminProductId = Number(product.adminProductId || 0)
    if (adminProductId <= 0) continue
    const [rows] = await connection.execute(
      'SELECT status FROM admin_products WHERE id = ? AND store_id = ? FOR UPDATE',
      [adminProductId, membership.storeId]
    )
    if (!rows[0]) throw new BatchPurchaseError(409, '后台商品已发生变化，请返回商品页刷新')
    if (!isProductActiveStatus(rows[0].status)) {
      throw new BatchPurchaseError(409, '商品已停用，请先重新启用', 'PRODUCT_INACTIVE')
    }
  }
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function strictText(value, label, maximum, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BatchPurchaseError(400, `${label}缺失`)
    return ''
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BatchPurchaseError(400, `${label}格式不正确`)
  }
  const result = text(value)
  if (required && !result) throw new BatchPurchaseError(400, `${label}缺失`)
  if (result.length > maximum) throw new BatchPurchaseError(400, `${label}过长`)
  return result
}

function transactionPart(value, label, maximum) {
  const result = strictText(value, label, maximum, true)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    throw new BatchPurchaseError(400, `${label}格式不正确`)
  }
  return result
}

function positiveInteger(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new BatchPurchaseError(400, '采购数量必须是大于 0 的整数')
  }
  return result
}

function positiveMoney(value) {
  const result = Number(value)
  if (!Number.isFinite(result) || result <= 0 || result > 9999999999.99) {
    throw new BatchPurchaseError(400, '进货单价必须大于 0')
  }
  return Math.round(result * 100) / 100
}

function derivePurchaseTransactionId(batchTransactionId, lineId) {
  const digest = crypto.createHash('sha256')
    .update(batchTransactionId)
    .update('\0')
    .update(lineId)
    .digest('hex')
  return `batch:${digest}`
}

function normalizeBatchRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BatchPurchaseError(400, '批量采购请求格式不正确')
  }
  const batchTransactionId = transactionPart(
    body.batchTransactionId,
    '批次交易编号',
    MAX_BATCH_ID_LENGTH
  )
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new BatchPurchaseError(400, '请至少提交一行采购商品')
  }
  if (body.items.length > MAX_BATCH_ITEMS) {
    throw new BatchPurchaseError(400, `单次采购不能超过 ${MAX_BATCH_ITEMS} 行`)
  }
  const supplier = strictText(body.supplier, '供应商', 120, false)
  const note = strictText(body.note, '备注', 200, false)
  const lineIds = new Set()
  const items = body.items.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new BatchPurchaseError(400, `第 ${index + 1} 行格式不正确`)
    }
    const lineId = transactionPart(source.lineId, `第 ${index + 1} 行编号`, MAX_LINE_ID_LENGTH)
    if (lineIds.has(lineId)) throw new BatchPurchaseError(400, `采购行编号重复：${lineId}`)
    lineIds.add(lineId)
    const productId = strictText(source.productId, `第 ${index + 1} 行商品`, 100, true)
    const specId = strictText(source.specId, `第 ${index + 1} 行规格`, 100, true)
    return {
      lineId,
      transactionId: derivePurchaseTransactionId(batchTransactionId, lineId),
      productId,
      specId,
      quantity: positiveInteger(source.quantity),
      unitCost: positiveMoney(source.unitCost),
      supplier,
      note
    }
  })
  return { batchTransactionId, supplier, note, items }
}

function parseState(row) {
  if (!row) throw new BatchPurchaseError(409, '服务器经营数据尚未初始化，请重新登录同步')
  try {
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state
    if (!state || !Array.isArray(state.products)) throw new Error('products missing')
    return state
  } catch (error) {
    throw new BatchPurchaseError(409, '服务器经营数据格式不正确，请重新同步')
  }
}

function sameMoney(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100)
}

function recordMatches(record, item) {
  return text(record && record.id) === item.transactionId &&
    text(record && record.productId) === item.productId &&
    text(record && record.specId) === item.specId &&
    Number(record && record.quantity) === item.quantity &&
    sameMoney(record && record.unitCost, item.unitCost) &&
    text(record && record.supplier) === item.supplier &&
    text(record && record.note) === item.note
}

function existingBatch(state, batch) {
  const purchases = Array.isArray(state && state.purchases) ? state.purchases : []
  const batchRecords = purchases.filter(record => text(record && record.batchTransactionId) === batch.batchTransactionId)
  const matches = batch.items.map(item => purchases.filter(record => text(record && record.id) === item.transactionId))
  if (!batchRecords.length && matches.every(records => records.length === 0)) return null
  if (batchRecords.length !== batch.items.length ||
      matches.some(records => records.length !== 1) ||
      matches.some((records, index) => !recordMatches(records[0], batch.items[index]))) {
    throw new BatchPurchaseError(
      409,
      '批次交易编号已被不同内容使用，请刷新后重新确认',
      'BATCH_TRANSACTION_CONFLICT'
    )
  }
  return matches.map(records => records[0])
}

function operationFor(state, transactionId) {
  const operations = Array.isArray(state && state.operations) ? state.operations : []
  return operations.find(operation => text(operation && operation.referenceId) === transactionId) || null
}

function transactionResult(record, operation) {
  return {
    recordId: record.id,
    productId: record.productId,
    specId: record.specId,
    productName: record.productName,
    specText: record.specText,
    quantity: Number(record.quantity),
    beforeStock: Number(operation && operation.before || 0),
    afterStock: Number(operation && operation.after || 0),
    unitAmount: Number(record.unitCost),
    totalAmount: Number(record.totalCost)
  }
}

function batchResponse(batch, state, revision, duplicate, records) {
  const transactions = records.map(record => transactionResult(record, operationFor(state, record.id)))
  return {
    state,
    revision,
    duplicate,
    batchTransactionId: batch.batchTransactionId,
    transactions,
    totalCost: Math.round(transactions.reduce((sum, item) => sum + item.totalAmount, 0) * 100) / 100
  }
}

async function updateAdminProducts(connection, membership, results) {
  const products = new Map()
  results.forEach(result => {
    const adminProductId = Number(result.product && result.product.adminProductId || 0)
    if (adminProductId > 0) products.set(adminProductId, result.product)
  })
  for (const [adminProductId, product] of products) {
    const [update] = await connection.execute(
      `UPDATE admin_products
       SET stock = ?, cost_price = ?, price = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND store_id = ?`,
      [
        stockOf(product),
        Number(product.costPrice || 0),
        Number(product.salePrice || 0),
        adminProductId,
        membership.storeId
      ]
    )
    if (Number(update && update.affectedRows || 0) !== 1) {
      throw new BatchPurchaseError(409, '后台商品已发生变化，请返回商品页刷新')
    }
  }
}

async function insertAuditLogs(connection, membership, batch, results, requestId) {
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const item = batch.items[index]
    await connection.execute(
      `INSERT INTO audit_logs
         (store_id, user_id, action, target_type, target_id, request_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        membership.storeId,
        membership.userId,
        'miniapp.purchase.create',
        'purchase',
        result.record.id,
        requestId,
        JSON.stringify({
          batchTransactionId: batch.batchTransactionId,
          lineId: item.lineId,
          productId: result.record.productId,
          specId: result.record.specId,
          quantity: result.record.quantity,
          beforeStock: result.beforeStock,
          afterStock: result.afterStock
        })
      ]
    )
  }
}

async function commitPurchaseBatch(pool, membership, body, requestId, now) {
  const batch = normalizeBatchRequest(body)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      'SELECT state, revision FROM store_states WHERE store_id = ? FOR UPDATE',
      [membership.storeId]
    )
    const state = parseState(rows[0])
    const revision = Number(rows[0].revision || 0)
    const previous = existingBatch(state, batch)
    if (previous) {
      const response = batchResponse(batch, state, revision, true, previous)
      await connection.commit()
      return response
    }

    const occurredAt = now || new Date()
    await assertBatchProductsActive(connection, state, membership, batch)
    const results = batch.items.map(item => {
      const result = applyPurchase(state, item, occurredAt)
      result.record.batchTransactionId = batch.batchTransactionId
      result.record.batchLineId = item.lineId
      return result
    })
    const nextRevision = revision + 1
    const [stateUpdate] = await connection.execute(
      `UPDATE store_states
       SET state = ?, revision = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ?`,
      [JSON.stringify(state), nextRevision, membership.userId, membership.storeId]
    )
    if (Number(stateUpdate && stateUpdate.affectedRows || 0) !== 1) {
      throw new BatchPurchaseError(409, '服务器经营数据已发生变化，请刷新后重试')
    }

    await updateAdminProducts(connection, membership, results)
    await insertAuditLogs(connection, membership, batch, results, requestId)
    await connection.commit()
    return batchResponse(batch, state, nextRevision, false, results.map(result => result.record))
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

module.exports = {
  MAX_BATCH_ITEMS,
  BatchPurchaseError,
  assertBatchProductsActive,
  commitPurchaseBatch,
  derivePurchaseTransactionId,
  existingBatch,
  normalizeBatchRequest,
  recordMatches
}
