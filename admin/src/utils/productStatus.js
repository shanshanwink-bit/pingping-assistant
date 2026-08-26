export const PRODUCT_STATUS_SELLING = '销售中'
export const PRODUCT_STATUS_OUT_OF_STOCK = '缺货'
export const PRODUCT_STATUS_INACTIVE = '已停用'

export function normalizeProductStatus(value) {
  const status = String(value || '').trim()
  if (status === PRODUCT_STATUS_INACTIVE || status === PRODUCT_STATUS_OUT_OF_STOCK) return status
  return PRODUCT_STATUS_SELLING
}

export function isProductActiveStatus(value) {
  return normalizeProductStatus(value) !== PRODUCT_STATUS_INACTIVE
}

export function productStatusMatchesFilter(status, filter) {
  if (filter === 'all') return true
  return filter === 'inactive' ? !isProductActiveStatus(status) : isProductActiveStatus(status)
}

export function toggledProductStatus(status) {
  return isProductActiveStatus(status) ? PRODUCT_STATUS_INACTIVE : PRODUCT_STATUS_SELLING
}
