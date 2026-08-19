const MIN_CANDIDATE_SCORE = 28
const UNIQUE_MATCH_SCORE = 55
const UNIQUE_MATCH_GAP = 15
const MIN_UNIQUE_CONFIDENCE = 0.65

class RecognitionDataError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 500
  }
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function normalizeText(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function businessType(value) {
  const normalized = text(value).toLowerCase()
  if (normalized === 'cosmetics' || normalized === '化妆品') return 'cosmetics'
  return 'clothing'
}

function stockOf(product) {
  return (Array.isArray(product && product.specs) ? product.specs : [])
    .reduce((sum, spec) => {
      const stock = Number(spec.stock || 0)
      return sum + (Number.isFinite(stock) ? Math.max(0, stock) : 0)
    }, 0)
}

function validMoney(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null
}

function knownSalePrice(value) {
  const price = validMoney(value)
  return price !== null && price > 0 ? price : null
}

function safeStock(value) {
  const stock = Number(value)
  return Number.isFinite(stock) ? Math.max(0, stock) : 0
}

function parsedState(row) {
  if (!row || row.state === undefined || row.state === null) return { products: [], purchases: [] }
  try {
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state
    return {
      products: Array.isArray(state && state.products) ? state.products : [],
      purchases: Array.isArray(state && state.purchases) ? state.purchases : []
    }
  } catch (error) {
    throw new RecognitionDataError('店铺经营数据无法读取')
  }
}

function purchaseTime(record) {
  const value = Date.parse(text(record && record.createdAt).replace(' ', 'T'))
  return Number.isFinite(value) ? value : 0
}

function purchaseSummary(records, historyReliable) {
  const valid = records.filter(item => purchaseTime(item) > 0).sort((a, b) => purchaseTime(b) - purchaseTime(a))
  const recent = valid[0]
  const oldest = valid[valid.length - 1]
  return {
    recentPurchase: recent ? {
      occurredAt: text(recent.createdAt),
      unitCost: Number(recent.unitCost) > 0 ? validMoney(recent.unitCost) : null
    } : null,
    firstPurchase: historyReliable && oldest ? { occurredAt: text(oldest.createdAt) } : null,
    purchaseHistoryReliable: Boolean(historyReliable)
  }
}

function specLabels(stateProduct, specCount) {
  const labels = (Array.isArray(stateProduct && stateProduct.specs) ? stateProduct.specs : [])
    .slice(0, 12)
    .map(spec => [text(spec.color), text(spec.size)].filter(Boolean).join(' / '))
    .filter(Boolean)
  if (labels.length) return labels
  return Number(specCount) > 0 ? [`共 ${Number(specCount)} 个规格`] : []
}

function stateProductFor(row, stateProducts) {
  return stateProducts.find(product => Number(product.adminProductId || 0) === Number(row.id)) ||
    stateProducts.find(product => text(product.code) && text(product.code) === text(row.code)) || null
}

function businessProduct(row, stateProduct, purchases) {
  const local = stateProduct || {}
  const productId = text(local.id) || `admin-product-${Number(row.id)}`
  const productPurchases = purchases.filter(record => text(record.productId) === productId)
  const historyReliable = local.purchaseHistoryComplete === true
  return {
    id: productId,
    adminProductId: Number(row.id) || Number(local.adminProductId) || null,
    code: text(row.code || local.code),
    name: text(row.name || local.name) || '未命名商品',
    businessType: businessType(row.business_type || local.businessType),
    category: text(row.category || local.category),
    brand: text(local.brand),
    itemNumber: text(local.itemNumber),
    specs: specLabels(local, row.spec_count),
    salePrice: knownSalePrice(row.price !== undefined ? row.price : local.salePrice),
    stock: row.stock !== undefined ? safeStock(row.stock) : stockOf(local),
    ...purchaseSummary(productPurchases, historyReliable)
  }
}

function stateOnlyProduct(product, purchases) {
  return businessProduct({
    id: product.adminProductId,
    code: product.code,
    name: product.name,
    business_type: product.businessType,
    category: product.category,
    spec_count: Array.isArray(product.specs) ? product.specs.length : 0,
    price: product.salePrice,
    stock: stockOf(product)
  }, product, purchases)
}

async function loadBusinessProducts(pool, storeId) {
  try {
    const [adminResult, stateResult] = await Promise.all([
      pool.execute(
        `SELECT id,name,code,business_type,category,spec_count,stock,price
         FROM admin_products
         WHERE store_id = ? AND status IN ('销售中','缺货')
         ORDER BY sort_order,id`,
        [storeId]
      ),
      pool.execute('SELECT state FROM store_states WHERE store_id = ? LIMIT 1', [storeId])
    ])
    const adminRows = Array.isArray(adminResult[0]) ? adminResult[0] : []
    const state = parsedState(Array.isArray(stateResult[0]) ? stateResult[0][0] : null)
    const matchedStateIds = new Set()
    const products = adminRows.map(row => {
      const local = stateProductFor(row, state.products)
      if (local) matchedStateIds.add(text(local.id))
      return businessProduct(row, local, state.purchases)
    })
    state.products.forEach(product => {
      if (!matchedStateIds.has(text(product.id))) products.push(stateOnlyProduct(product, state.purchases))
    })
    return products
  } catch (error) {
    if (error instanceof RecognitionDataError) throw error
    throw new RecognitionDataError('真实商品数据查询失败')
  }
}

function sharedCharacterRatio(left, right) {
  const a = new Set(Array.from(normalizeText(left)).filter(character => /[\p{L}\p{N}]/u.test(character)))
  const b = new Set(Array.from(normalizeText(right)).filter(character => /[\p{L}\p{N}]/u.test(character)))
  if (!a.size || !b.size) return 0
  let overlap = 0
  a.forEach(character => { if (b.has(character)) overlap += 1 })
  return overlap / Math.min(a.size, b.size)
}

function scoreProduct(vision, product) {
  const name = normalizeText(product.name)
  const code = normalizeText(product.code)
  const brand = normalizeText(product.brand)
  const searchable = normalizeText([
    product.name, product.code, product.itemNumber, product.category, product.brand, ...(product.specs || [])
  ].join(' '))
  const terms = Array.from(new Set(
    [vision.productName, vision.brand, vision.spec, ...(vision.visibleText || []), ...(vision.keywords || [])]
      .map(normalizeText).filter(Boolean)
  ))
  let score = 0
  const reasons = []
  if (code && terms.includes(code)) { score += 60; reasons.push('货号文字一致') }
  const visionName = normalizeText(vision.productName)
  if (visionName && visionName === name) { score += 55; reasons.push('商品名称一致') }
  else if (visionName && Math.min(visionName.length, name.length) >= 2 && (visionName.includes(name) || name.includes(visionName))) {
    score += 34; reasons.push('商品名称相近')
  } else {
    const ratio = visionName.length >= 2 ? sharedCharacterRatio(vision.productName, product.name) : 0
    if (ratio >= 0.5) { score += 20; reasons.push('品名特征相近') }
    else if (ratio >= 0.25) score += 10
  }
  let termScore = 0
  terms.forEach(term => {
    if (term.length >= 2 && searchable.includes(term)) termScore += 12
  })
  if (termScore) { score += Math.min(36, termScore); reasons.push('包装文字或规格匹配') }
  if (brand && normalizeText(vision.brand) === brand) { score += 18; reasons.push('品牌一致') }
  if (vision.category !== 'unknown' && vision.category === product.businessType) {
    score += 8; reasons.push('商品类型一致')
  }
  return { product, score: Math.min(100, score), reasons: reasons.slice(0, 3) }
}

function publicCandidate(item) {
  return { ...item.product, matchScore: item.score, matchReasons: item.reasons }
}

function matchProducts(vision, products) {
  const ranked = (Array.isArray(products) ? products : [])
    .map(product => scoreProduct(vision, product))
    .filter(item => item.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'zh-CN'))
  if (!ranked.length) return { matchType: 'none', items: [] }
  const first = ranked[0]
  const gap = first.score - (ranked[1] ? ranked[1].score : 0)
  if (Number(vision.confidence) >= MIN_UNIQUE_CONFIDENCE &&
      first.score >= UNIQUE_MATCH_SCORE && (!ranked[1] || gap >= UNIQUE_MATCH_GAP)) {
    return { matchType: 'unique', items: [publicCandidate(first)] }
  }
  return { matchType: 'candidates', items: ranked.slice(0, 3).map(publicCandidate) }
}

module.exports = {
  MIN_CANDIDATE_SCORE,
  MIN_UNIQUE_CONFIDENCE,
  UNIQUE_MATCH_GAP,
  UNIQUE_MATCH_SCORE,
  RecognitionDataError,
  loadBusinessProducts,
  matchProducts,
  normalizeText,
  scoreProduct
}
