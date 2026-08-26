const MIN_CANDIDATE_SCORE = 28
const UNIQUE_MATCH_SCORE = 55
const UNIQUE_MATCH_GAP = 15
const MIN_UNIQUE_CONFIDENCE = 0.65
const MATCH_PRIORITY = Object.freeze({
  ocr: 1,
  legacyCode: 2,
  identity: 3,
  normalizedItemNumber: 4,
  rawItemNumber: 5
})
const { isProductActiveStatus, normalizeProductStatus } = require('./product-status')

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
    itemNumber: text(row.item_number) || (Boolean(row.item_number_managed) ? '' : text(local.itemNumber)),
    status: normalizeProductStatus(row.status || local.status),
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
    stock: stockOf(product),
    status: product.status
  }, product, purchases)
}

async function loadBusinessProducts(pool, storeId) {
  try {
    const [adminResult, stateResult] = await Promise.all([
      pool.execute(
        `SELECT id,name,code,item_number,item_number_managed,business_type,category,spec_count,stock,price,status
         FROM admin_products
         WHERE store_id = ?
         ORDER BY sort_order,id`,
        [storeId]
      ),
      pool.execute('SELECT state FROM store_states WHERE store_id = ? LIMIT 1', [storeId])
    ])
    const adminRows = Array.isArray(adminResult[0]) ? adminResult[0] : []
    const state = parsedState(Array.isArray(stateResult[0]) ? stateResult[0][0] : null)
    const matchedStateIds = new Set()
    const products = []
    adminRows.forEach(row => {
      const local = stateProductFor(row, state.products)
      if (local) matchedStateIds.add(text(local.id))
      const product = businessProduct(row, local, state.purchases)
      if (isProductActiveStatus(product.status)) products.push(product)
    })
    state.products.forEach(product => {
      if (!matchedStateIds.has(text(product.id)) && isProductActiveStatus(product.status)) {
        products.push(stateOnlyProduct(product, state.purchases))
      }
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

function identityScore(vision, product) {
  const name = normalizeText(product.name)
  const brand = normalizeText(product.brand)
  let score = 0
  const reasons = []
  const visionName = normalizeText(vision.productName)
  if (visionName && visionName === name) { score += 55; reasons.push('商品名称一致') }
  else if (visionName && Math.min(visionName.length, name.length) >= 2 && (visionName.includes(name) || name.includes(visionName))) {
    score += 34; reasons.push('商品名称相近')
  } else {
    const ratio = visionName.length >= 2 ? sharedCharacterRatio(vision.productName, product.name) : 0
    if (ratio >= 0.5) { score += 20; reasons.push('品名特征相近') }
    else if (ratio >= 0.25) score += 10
  }
  if (brand && normalizeText(vision.brand) === brand) { score += 18; reasons.push('品牌一致') }
  const visionSpec = normalizeText(vision.spec)
  const specs = (product.specs || []).map(normalizeText).filter(Boolean)
  if (visionSpec && specs.some(spec => spec === visionSpec || spec.includes(visionSpec))) {
    score += 16
    reasons.push('包装文字或规格匹配')
  }
  if (vision.category !== 'unknown' && vision.category === product.businessType) {
    score += 8; reasons.push('商品类型一致')
  }
  return { score, reasons }
}

function ocrScore(vision, product) {
  const searchable = normalizeText([
    product.name, product.itemNumber, product.category, product.brand, ...(product.specs || [])
  ].join(' '))
  const recognizedSpec = normalizeText(vision.spec)
  const terms = Array.from(new Set(
    [...(Array.isArray(vision.visibleText) ? vision.visibleText : []), ...(Array.isArray(vision.keywords) ? vision.keywords : [])]
      .map(normalizeText).filter(term => term.length >= 2 && term !== recognizedSpec)
  ))
  const matches = terms.filter(term => searchable.includes(term)).length
  if (!matches) return { score: 0, reasons: [] }
  return { score: Math.min(36, matches * 12), reasons: ['包装文字或规格匹配'] }
}

function scoreProduct(vision, product) {
  const productCode = text(vision && vision.productCode)
  const itemNumber = text(product && product.itemNumber)
  if (productCode && itemNumber && productCode === itemNumber) {
    return { product, priority: MATCH_PRIORITY.rawItemNumber, score: 100, reasons: ['真实货号原值一致'] }
  }
  if (normalizeText(productCode) && normalizeText(productCode) === normalizeText(itemNumber)) {
    return { product, priority: MATCH_PRIORITY.normalizedItemNumber, score: 96, reasons: ['真实货号标准化一致'] }
  }

  const identity = identityScore(vision, product)
  const ocr = ocrScore(vision, product)
  if (identity.score >= MIN_CANDIDATE_SCORE) {
    return {
      product,
      priority: MATCH_PRIORITY.identity,
      score: Math.min(100, identity.score + ocr.score),
      reasons: Array.from(new Set([...identity.reasons, ...ocr.reasons])).slice(0, 3)
    }
  }

  const legacyCode = normalizeText(product && product.code)
  if (normalizeText(productCode) && legacyCode === normalizeText(productCode)) {
    return { product, priority: MATCH_PRIORITY.legacyCode, score: 60, reasons: ['内部流水号兼容一致'] }
  }

  const fuzzyScore = identity.score + ocr.score
  return {
    product,
    priority: MATCH_PRIORITY.ocr,
    score: Math.min(100, fuzzyScore),
    reasons: Array.from(new Set([...identity.reasons, ...ocr.reasons])).slice(0, 3)
  }
}

function publicCandidate(item) {
  return { ...item.product, matchScore: item.score, matchReasons: item.reasons }
}

function matchProducts(vision, products, options) {
  const includeInactive = Boolean(options && options.includeInactive)
  const ranked = (Array.isArray(products) ? products : [])
    .filter(product => includeInactive || isProductActiveStatus(product && product.status))
    .map(product => scoreProduct(vision, product))
    .filter(item => item.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.priority - a.priority || b.score - a.score || a.product.name.localeCompare(b.product.name, 'zh-CN'))
  if (!ranked.length) return { matchType: 'none', items: [] }
  const first = ranked[0]
  const itemNumberMatches = ranked.filter(item => item.priority >= MATCH_PRIORITY.normalizedItemNumber)
  const duplicateItemNumber = first.priority >= MATCH_PRIORITY.normalizedItemNumber && itemNumberMatches.length > 1
  const tier = duplicateItemNumber
    ? itemNumberMatches
    : ranked.filter(item => item.priority === first.priority)
  const gap = first.score - (tier[1] ? tier[1].score : 0)
  if (Number(vision.confidence) >= MIN_UNIQUE_CONFIDENCE &&
      !duplicateItemNumber && first.score >= UNIQUE_MATCH_SCORE && (!tier[1] || gap >= UNIQUE_MATCH_GAP)) {
    return { matchType: 'unique', items: [publicCandidate(first)] }
  }
  return { matchType: 'candidates', items: tier.slice(0, 3).map(publicCandidate) }
}

module.exports = {
  MIN_CANDIDATE_SCORE,
  MIN_UNIQUE_CONFIDENCE,
  MATCH_PRIORITY,
  UNIQUE_MATCH_GAP,
  UNIQUE_MATCH_SCORE,
  RecognitionDataError,
  loadBusinessProducts,
  matchProducts,
  normalizeText,
  scoreProduct
}
