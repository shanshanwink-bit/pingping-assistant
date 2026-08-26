const PRODUCT_STATUS_SELLING = '销售中'
const PRODUCT_STATUS_OUT_OF_STOCK = '缺货'
const PRODUCT_STATUS_INACTIVE = '已停用'

function normalizeProductStatus(value) {
  const status = String(value || '').trim()
  if (status === PRODUCT_STATUS_INACTIVE || status === PRODUCT_STATUS_OUT_OF_STOCK) return status
  return PRODUCT_STATUS_SELLING
}

function isProductActiveStatus(value) {
  return normalizeProductStatus(value) !== PRODUCT_STATUS_INACTIVE
}

function isProductInactiveStatus(value) {
  return !isProductActiveStatus(value)
}

module.exports = {
  PRODUCT_STATUS_INACTIVE,
  PRODUCT_STATUS_OUT_OF_STOCK,
  PRODUCT_STATUS_SELLING,
  isProductActiveStatus,
  isProductInactiveStatus,
  normalizeProductStatus
}
