const crypto = require('node:crypto')
const {
  MIN_UNIQUE_CONFIDENCE,
  matchProducts,
  normalizeText
} = require('./product-matcher')

class PurchaseDraftDataError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 500
  }
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function safeStock(value) {
  const result = Number(value)
  return Number.isFinite(result) ? Math.max(0, result) : 0
}

function specLabel(spec) {
  return [text(spec && spec.color), text(spec && spec.size)].filter(Boolean).join(' / ') || '未命名规格'
}

function purchasableProduct(product) {
  const specs = (Array.isArray(product && product.specs) ? product.specs : [])
    .filter(spec => text(spec && (spec.specId || spec.id)))
    .map(spec => ({
      specId: text(spec.specId || spec.id),
      label: text(spec.label) || specLabel(spec),
      color: text(spec.color),
      size: text(spec.size),
      stock: safeStock(spec.stock)
    }))
  return {
    id: text(product && product.id),
    adminProductId: Number(product && product.adminProductId) || null,
    code: text(product && product.code),
    itemNumber: text(product && product.itemNumber),
    name: text(product && product.name) || '未命名商品',
    businessType: product && product.businessType === 'cosmetics' ? 'cosmetics' : 'clothing',
    category: text(product && product.category),
    brand: text(product && product.brand),
    specs
  }
}

function parseProducts(row) {
  if (!row || row.state === undefined || row.state === null) return []
  try {
    const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state
    if (!state || !Array.isArray(state.products)) throw new Error('products missing')
    return state.products.map(purchasableProduct).filter(product => product.id)
  } catch (error) {
    throw new PurchaseDraftDataError('店铺商品数据无法读取')
  }
}

async function loadPurchasableProducts(pool, storeId) {
  try {
    const [rows] = await pool.execute(
      'SELECT state FROM store_states WHERE store_id = ? LIMIT 1',
      [storeId]
    )
    return parseProducts(Array.isArray(rows) ? rows[0] : null)
  } catch (error) {
    if (error instanceof PurchaseDraftDataError) throw error
    throw new PurchaseDraftDataError('真实商品数据查询失败')
  }
}

function recognitionForMatch(item) {
  const confidence = Number(item && item.confidence)
  const productCode = text(item && item.productCode)
  return {
    category: 'unknown',
    productName: text(item && item.productName),
    brand: '',
    spec: text(item && item.spec),
    visibleText: productCode ? [productCode] : [],
    keywords: productCode ? [productCode] : [],
    confidence: Number.isFinite(confidence) ? confidence : 0
  }
}

function matchProjection(product) {
  return {
    id: product.id,
    adminProductId: product.adminProductId,
    code: product.code,
    itemNumber: product.itemNumber,
    name: product.name,
    businessType: product.businessType,
    category: product.category,
    brand: product.brand,
    specs: product.specs.map(spec => spec.label)
  }
}

function publicCandidate(matched, products) {
  const source = products.find(product => product.id === text(matched.id))
  if (!source) return null
  return {
    productId: source.id,
    name: source.name,
    productCode: source.code || source.itemNumber,
    businessType: source.businessType,
    matchScore: Number(matched.matchScore || 0),
    matchReasons: Array.isArray(matched.matchReasons) ? matched.matchReasons.slice() : [],
    specs: source.specs.map(spec => ({ ...spec }))
  }
}

function matchPurchaseProducts(item, products) {
  const vision = recognitionForMatch(item)
  const identifier = normalizeText(item && item.productCode)
  const exact = identifier ? products.filter(product => (
    [product.code, product.itemNumber].map(normalizeText).filter(Boolean).includes(identifier)
  )) : []
  if (exact.length) {
    const items = exact
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .slice(0, 3)
      .map(product => ({
        ...matchProjection(product),
        matchScore: 100,
        matchReasons: ['商品编号一致']
      }))
    return {
      matchType: exact.length === 1 && vision.confidence >= MIN_UNIQUE_CONFIDENCE ? 'unique' : 'candidates',
      items
    }
  }
  return matchProducts(vision, products.map(matchProjection))
}

function exactSpecMatches(recognizedSpec, specs) {
  const target = normalizeText(recognizedSpec)
  if (!target) return []
  return specs.filter(spec => {
    const values = [spec.label, spec.color, spec.size].map(normalizeText).filter(Boolean)
    return values.includes(target)
  })
}

function selectedSpec(recognizedSpec, specs) {
  if (specs.length === 1) return specs[0]
  const exact = exactSpecMatches(recognizedSpec, specs)
  return exact.length === 1 ? exact[0] : null
}

function recognizedItem(item) {
  return {
    productName: text(item && item.productName),
    productCode: text(item && item.productCode),
    spec: text(item && item.spec),
    quantity: Number.isInteger(item && item.quantity) && item.quantity > 0 ? item.quantity : null,
    unitCost: Number.isFinite(Number(item && item.unitCost)) && Number(item.unitCost) > 0
      ? Math.round(Number(item.unitCost) * 100) / 100
      : null,
    lineTotal: Number.isFinite(Number(item && item.lineTotal)) && Number(item.lineTotal) > 0
      ? Math.round(Number(item.lineTotal) * 100) / 100
      : null,
    confidence: Number.isFinite(Number(item && item.confidence)) ? Number(item.confidence) : null
  }
}

function itemIssues(productId, specId, recognized, candidates, originalIssues) {
  const issues = (Array.isArray(originalIssues) ? originalIssues : []).filter(issue => {
    if (issue === '行金额无法确认') return false
    if (productId && issue === '商品名称或编号无法确认') return false
    if (specId && issue === '规格无法确认') return false
    if (recognized.quantity !== null && issue === '数量无法确认') return false
    if (recognized.unitCost !== null && issue === '单价无法确认') return false
    return true
  })
  if (!productId) {
    issues.push(candidates.length ? '请选择正确的商品' : '未找到匹配商品，请人工选择')
  } else if (!specId) {
    issues.push('请选择正确的商品规格')
  }
  if (recognized.quantity === null && !issues.includes('数量无法确认')) issues.push('数量无法确认')
  if (recognized.unitCost === null && !issues.includes('单价无法确认')) issues.push('单价无法确认')
  return Array.from(new Set(issues))
}

function draftItem(item, products) {
  const recognized = recognizedItem(item)
  const matched = matchPurchaseProducts(item, products)
  const candidates = matched.items.map(candidate => publicCandidate(candidate, products)).filter(Boolean)
  const uniqueProduct = matched.matchType === 'unique' ? candidates[0] : null
  const spec = uniqueProduct ? selectedSpec(recognized.spec, uniqueProduct.specs) : null
  const productId = uniqueProduct ? uniqueProduct.productId : ''
  const specId = spec ? spec.specId : ''
  let matchStatus = 'ready'
  if (!productId) matchStatus = 'needs_product'
  else if (!specId) matchStatus = 'needs_spec'
  else if (recognized.quantity === null || recognized.unitCost === null) matchStatus = 'needs_values'
  const issues = itemIssues(productId, specId, recognized, candidates, item && item.issues)
  return {
    lineId: text(item && item.lineId),
    recognized,
    matchStatus,
    productId,
    specId,
    quantity: recognized.quantity,
    unitCost: recognized.unitCost,
    candidates,
    specCandidates: uniqueProduct ? uniqueProduct.specs.map(option => ({ ...option })) : [],
    requiresManual: matchStatus !== 'ready',
    issues
  }
}

function createPurchaseDraftFromProducts(recognition, products, draftId) {
  const items = Array.isArray(recognition && recognition.items) ? recognition.items : []
  const availableProducts = Array.isArray(products) ? products.map(purchasableProduct).filter(product => product.id) : []
  return {
    draftId: text(draftId) || crypto.randomUUID(),
    items: items.map(item => draftItem(item, availableProducts))
  }
}

async function createPurchaseDraft(pool, storeId, recognition, dependencies) {
  const deps = dependencies || {}
  const loadProducts = deps.loadProducts || loadPurchasableProducts
  const draftIdFactory = deps.draftIdFactory || crypto.randomUUID
  const products = await loadProducts(pool, storeId)
  return createPurchaseDraftFromProducts(recognition, products, draftIdFactory())
}

module.exports = {
  MIN_UNIQUE_CONFIDENCE,
  PurchaseDraftDataError,
  createPurchaseDraft,
  createPurchaseDraftFromProducts,
  exactSpecMatches,
  loadPurchasableProducts,
  matchPurchaseProducts,
  purchasableProduct,
  selectedSpec
}
