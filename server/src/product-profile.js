class ProductProfileError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

const { isProductActiveStatus } = require('./product-status')

function textField(value, label, maxLength, required) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new ProductProfileError(400, `${label}格式不正确`)
  }
  const result = String(value || '').trim()
  if (required && !result) throw new ProductProfileError(400, `请填写${label}`)
  if ([...result].length > maxLength) throw new ProductProfileError(400, `${label}最多 ${maxLength} 个字符`)
  return result
}

function moneyField(value, label) {
  if (value === '' || value === undefined || value === null) return 0
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0 || result > 9999999999.99) {
    throw new ProductProfileError(400, `${label}格式不正确`)
  }
  return Math.round(result * 100) / 100
}

function normalizeProductProfile(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const status = textField(source.status || '销售中', '商品状态', 20, true)
  if (!['销售中', '缺货', '已停用'].includes(status)) throw new ProductProfileError(400, '商品状态不正确')
  return {
    name: textField(source.name, '商品名称', 120, true),
    itemNumber: textField(source.itemNumber, '货号', 80, false),
    category: textField(source.category, '商品分类', 40, true),
    salePrice: moneyField(source.salePrice, '参考售价'),
    costPrice: moneyField(source.costPrice, '成本价'),
    status
  }
}

function auditValue(value) {
  const text = String(value === undefined || value === null || value === '' ? '未填写' : value)
  return [...text].length > 32 ? `${[...text].slice(0, 32).join('')}…` : text
}

function productProfileChanges(current, next) {
  const changes = []
  const fields = [
    ['name', 'name'],
    ['itemNumber', 'itemNumber'],
    ['category', 'category'],
    ['salePrice', 'salePrice'],
    ['costPrice', 'costPrice'],
    ['status', 'status']
  ]
  fields.forEach(([field, label]) => {
    const before = field === 'salePrice' || field === 'costPrice' ? Number(current[field] || 0) : String(current[field] || '')
    const after = field === 'salePrice' || field === 'costPrice' ? Number(next[field] || 0) : String(next[field] || '')
    if (before !== after) changes.push({ field: label, before: auditValue(before), after: auditValue(after) })
  })
  return changes
}

async function updateProductProfile(pool, membership, productID, body, requestID) {
  const id = Number(productID)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ProductProfileError(400, '商品 ID 不正确')
  const input = normalizeProductProfile(body)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT id, code, name, item_number, item_number_managed, category, price, cost_price, status
       FROM admin_products WHERE store_id = ? AND id = ? FOR UPDATE`,
      [membership.storeId, id]
    )
    if (!rows[0]) throw new ProductProfileError(404, '商品不存在')
    const current = {
      name: String(rows[0].name || ''),
      itemNumber: String(rows[0].item_number || ''),
      category: String(rows[0].category || ''),
      salePrice: Number(rows[0].price || 0),
      costPrice: Number(rows[0].cost_price || 0),
      status: String(rows[0].status || '销售中')
    }
    const itemNumberManaged = Boolean(rows[0].item_number_managed) || input.itemNumber !== current.itemNumber
    const changes = productProfileChanges(current, input)
    const statusChanged = current.status !== input.status
    const action = statusChanged
      ? (isProductActiveStatus(input.status) ? 'miniapp.product.enable' : 'miniapp.product.disable')
      : 'miniapp.product.profile.update'
    await connection.execute(
      `UPDATE admin_products
       SET name = ?, item_number = ?, item_number_managed = ?, category = ?, price = ?, cost_price = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE store_id = ? AND id = ?`,
      [input.name, input.itemNumber || null, itemNumberManaged ? 1 : 0, input.category, input.salePrice, input.costPrice, input.status, membership.storeId, id]
    )
    await connection.execute(
      `INSERT INTO audit_logs (store_id, user_id, action, target_type, target_id, request_id, details)
       VALUES (?, ?, ?, 'product', ?, ?, ?)`,
      [membership.storeId, membership.userId, action, String(id), requestID, JSON.stringify({ changes })]
    )
    await connection.commit()
    return {
      id,
      code: String(rows[0].code || ''),
      ...input,
      itemNumberManaged
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

module.exports = {
  ProductProfileError,
  normalizeProductProfile,
  productProfileChanges,
  updateProductProfile
}
