const { normalizeBusinessType } = require('./catalog-products')
const { buildAttentionItems } = require('./home-dashboard')
const { isProductActiveStatus, normalizeProductStatus } = require('./product-status')
const { visibleSpecs } = require('./product-specs')

const SUMMARY_SPEC_PATTERN = /^(全部规格|汇总|聚合|SKU_SUMMARY)$/i
const TYPE_META = {
  clothing: {
    label: '服装',
    placeholderIcon: '/assets/icons/product-clothing.svg'
  },
  cosmetics: {
    label: '化妆品',
    placeholderIcon: '/assets/icons/product-cosmetics.svg'
  }
}

function text(value, fallback = '') {
  const result = String(value === undefined || value === null ? '' : value).trim()
  return result || fallback
}

function number(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function integer(value) {
  return String(Math.max(0, Math.round(number(value))))
}

function hasPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function formatMoney(value) {
  if (!hasPrice(value)) return ''
  return formatKnownMoney(Number(value))
}

function formatKnownMoney(value) {
  const amount = Number(value)
  const sign = amount < 0 ? '-' : ''
  const parts = Math.abs(amount).toFixed(2).split('.')
  return `${sign}¥${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1]}`
}

function productType(value) {
  return normalizeBusinessType(value)
}

function totalStock(product) {
  if (Number.isFinite(Number(product && product.totalStock))) {
    return Math.max(0, Math.round(Number(product.totalStock)))
  }
  return (Array.isArray(product && product.specs) ? product.specs : [])
    .reduce((sum, spec) => sum + Math.max(0, number(spec && spec.stock)), 0)
}

function stockPresentation(product) {
  const stock = totalStock(product)
  if (stock === 0) return { code: 'out', label: '已缺货', tone: 'danger' }
  const threshold = Math.max(0, number(product && product.lowStockThreshold))
  const specs = visibleSpecs(product && product.specs)
  const hasLowSpec = specs.some(spec => Math.max(0, number(spec && spec.stock)) <= threshold)
  if (hasLowSpec) return { code: 'low', label: '库存偏低', tone: 'warning' }
  return { code: 'normal', label: '库存正常', tone: 'success' }
}

function searchableValue(product) {
  return [product && product.name, product && product.itemNumber]
    .map(value => text(value).toLowerCase())
    .join('\n')
}

function filterProducts(products, options) {
  const settings = options || {}
  const keyword = text(settings.keyword).toLowerCase()
  const businessType = settings.businessType || 'all'
  return (Array.isArray(products) ? products : []).filter(product => {
    const matchesType = businessType === 'all' || productType(product && product.businessType) === businessType
    const matchesKeyword = !keyword || searchableValue(product).includes(keyword)
    return matchesType && matchesKeyword
  })
}

function buildListProduct(product, imageFailed) {
  const type = productType(product && product.businessType)
  const meta = TYPE_META[type]
  const stock = totalStock(product)
  const salePriceText = formatMoney(product && product.salePrice)
  return {
    id: text(product && product.id),
    name: text(product && product.name, '未命名商品'),
    itemNumber: text(product && product.itemNumber),
    identifier: text(product && product.itemNumber),
    status: normalizeProductStatus(product && product.status),
    isActive: isProductActiveStatus(product && product.status),
    category: text(product && product.category, '未分类'),
    businessType: type,
    typeLabel: meta.label,
    placeholderIcon: meta.placeholderIcon,
    displayImage: imageFailed ? '' : text(product && product.image),
    salePriceText,
    priceMissing: !salePriceText,
    totalStock: stock,
    totalStockText: integer(stock),
    stockStatus: stockPresentation(product)
  }
}

function isSummaryPart(value) {
  return SUMMARY_SPEC_PATTERN.test(text(value))
}

function specParts(spec) {
  const color = text(spec && spec.color)
  const size = text(spec && spec.size)
  const summary = isSummaryPart(color) || isSummaryPart(size)
  if (summary) return { color: '', size: '', label: '全部规格', summary: true }
  const visibleColor = color === '默认' ? '通用' : color
  const parts = [visibleColor, size].filter(Boolean)
  return { color: visibleColor, size, label: parts.join(' / ') || '未命名规格', summary: false }
}

function specPresentation(spec, threshold) {
  const stock = Math.max(0, Math.round(number(spec && spec.stock)))
  const status = stock === 0
    ? { label: '缺货', tone: 'danger' }
    : stock <= threshold ? { label: '偏低', tone: 'warning' } : { label: '正常', tone: 'normal' }
  return {
    id: text(spec && spec.id, `${specParts(spec).label}-${stock}`),
    ...specParts(spec),
    stock,
    stockText: integer(stock),
    status
  }
}

function buildSpecList(product) {
  const threshold = Math.max(0, number(product && product.lowStockThreshold))
  return visibleSpecs(product && product.specs)
    .map(spec => specPresentation(spec, threshold))
}

function buildClothingMatrix(product) {
  const specs = buildSpecList(product)
  if (!specs.length || specs.some(spec => spec.summary || !spec.color || !spec.size)) return null
  const colors = [...new Set(specs.map(spec => spec.color))]
  const sizes = [...new Set(specs.map(spec => spec.size))]
  if (colors.length === 1 && sizes.length === 1) return null
  const rows = colors.map(color => ({
    color,
    cells: sizes.map(size => {
      const matches = specs.filter(spec => spec.color === color && spec.size === size)
      if (!matches.length) return { size, stockText: '—', tone: 'empty', statusLabel: '无此规格' }
      const stock = matches.reduce((sum, spec) => sum + spec.stock, 0)
      const status = stockPresentation({ specs: [{ stock }], totalStock: stock, lowStockThreshold: product.lowStockThreshold })
      return { size, stockText: integer(stock), tone: status.tone, statusLabel: status.label }
    })
  }))
  return { sizes, rows, minWidth: 200 + sizes.length * 116 }
}

function expiryPresentation(product, now) {
  const expiryDate = text(product && product.expiryDate)
  if (!expiryDate) return null
  const expiry = new Date(`${expiryDate}T00:00:00`).getTime()
  if (!Number.isFinite(expiry)) return null
  const alerts = buildAttentionItems({ lowSpecs: [] }, [{ ...product, businessType: 'cosmetics', expiryDate }], now || new Date())
  if (alerts.length) {
    const alert = alerts[0]
    return {
      label: alert.detail,
      tone: alert.typeLabel === '已过期' ? 'danger' : 'warning',
      dateText: expiryDate
    }
  }
  return { label: '保质期正常', tone: 'success', dateText: expiryDate }
}

function cosmeticsPresentation(product, now) {
  const specs = buildSpecList(product)
  const fields = [
    { label: '品牌', value: text(product && product.brand) },
    { label: '规格', value: [...new Set(specs.map(spec => spec.label))].join('、') },
    { label: '批次', value: text(product && product.batchNumber) },
    { label: '到期日期', value: text(product && product.expiryDate) }
  ].filter(field => field.value)
  return { fields, expiry: expiryPresentation(product, now), specs }
}

function buildProductDetail(product, options) {
  const settings = options || {}
  const type = productType(product && product.businessType)
  const meta = TYPE_META[type]
  const salePriceText = formatMoney(product && product.salePrice)
  const costPriceText = formatMoney(product && product.costPrice)
  const marginText = salePriceText && costPriceText
    ? formatKnownMoney(number(product.salePrice) - number(product.costPrice))
    : ''
  const specs = buildSpecList(product)
  const matrix = type === 'clothing' ? buildClothingMatrix(product) : null
  return {
    id: text(product && product.id),
    name: text(product && product.name, '未命名商品'),
    itemNumber: text(product && product.itemNumber),
    identifier: text(product && product.itemNumber),
    status: normalizeProductStatus(product && product.status),
    isActive: isProductActiveStatus(product && product.status),
    category: text(product && product.category, '未分类'),
    businessType: type,
    typeLabel: meta.label,
    placeholderIcon: meta.placeholderIcon,
    displayImage: settings.imageFailed ? '' : text(product && product.image),
    salePriceText: salePriceText || '暂未设置',
    costPriceText: costPriceText || '暂未设置',
    marginText: marginText || '暂无法计算',
    totalStockText: integer(totalStock(product)),
    stockStatus: stockPresentation(product),
    specCountText: integer(specs.length),
    specDisplayMode: matrix ? 'matrix' : 'list',
    matrix,
    specs,
    cosmetics: type === 'cosmetics' ? cosmeticsPresentation(product, settings.now) : null
  }
}

function productDetailUrl(id) {
  return `/pages/product-detail/index?id=${encodeURIComponent(text(id))}`
}

module.exports = {
  buildClothingMatrix,
  buildListProduct,
  buildProductDetail,
  expiryPresentation,
  filterProducts,
  formatMoney,
  hasPrice,
  productDetailUrl,
  productType,
  specParts,
  stockPresentation,
  totalStock
}
