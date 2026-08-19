function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeBusinessType(value) {
  return value === '化妆品' || value === 'cosmetics' ? 'cosmetics' : 'clothing'
}

function reconcileSpecs(product, targetStock) {
  const specs = Array.isArray(product && product.specs) && product.specs.length
    ? clone(product.specs)
    : [{ id: `admin-spec-${product.adminProductId || product.id}`, color: '全部规格', size: '汇总', stock: 0 }]
  let remaining = Math.max(0, Number(targetStock || 0))
  specs.forEach((spec, index) => {
    const current = Math.max(0, Number(spec.stock || 0))
    const stock = index === specs.length - 1 ? remaining : Math.min(current, remaining)
    spec.stock = stock
    remaining -= stock
  })
  if (remaining > 0) specs[0].stock += remaining
  return specs
}

function mergeCatalogProduct(item, existing) {
  const adminProductId = Number(item.id)
  const base = existing || {
    id: `admin-product-${adminProductId}`,
    itemNumber: '',
    supplier: '',
    brand: '',
    expiryDate: '',
    createdAt: item.updatedAt || ''
  }
  return {
    ...clone(base),
    source: 'admin',
    adminProductId,
    name: String(item.name || '').trim(),
    code: String(item.code || ''),
    businessType: normalizeBusinessType(item.businessType),
    category: String(item.category || ''),
    specCount: Math.max(1, Number(item.specCount || 1)),
    costPrice: Math.max(0, Number(item.costPrice || 0)),
    salePrice: Math.max(0, Number(item.price || 0)),
    lowStockThreshold: Math.max(0, Number(item.lowStockThreshold || 0)),
    image: String(item.image || ''),
    specs: reconcileSpecs({ ...base, adminProductId }, item.stock),
    updatedAt: item.updatedAt || base.updatedAt || ''
  }
}

function mergeCatalogProducts(existingProducts, catalogItems) {
  const existing = Array.isArray(existingProducts) ? existingProducts : []
  const byAdminId = new Map()
  const byCode = new Map()
  existing.forEach(product => {
    if (product.adminProductId) byAdminId.set(Number(product.adminProductId), product)
    if (product.code) byCode.set(String(product.code), product)
  })

  const merged = (Array.isArray(catalogItems) ? catalogItems : []).map(item => {
    const match = byAdminId.get(Number(item.id)) || byCode.get(String(item.code || ''))
    return mergeCatalogProduct(item, match)
  })
  const adoptedIds = new Set(merged.map(product => product.id))
  const legacy = existing.filter(product => product.source !== 'admin' && !adoptedIds.has(product.id))
  return [...merged, ...legacy]
}

module.exports = { mergeCatalogProduct, mergeCatalogProducts, normalizeBusinessType }
