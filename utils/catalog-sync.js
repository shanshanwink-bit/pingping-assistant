const auth = require('./auth')
const serverSync = require('./server-sync')
const store = require('./store')

let inFlight = null

const LEGACY_PRODUCT_IMAGE_PREFIX = '/admin-api/v1/product-images/'
const PRODUCT_IMAGE_PREFIX = '/pingping-admin-api/v1/product-images/'

function formalProductImagePath(value) {
  const image = String(value || '')
  if (image.startsWith(LEGACY_PRODUCT_IMAGE_PREFIX)) {
    return `${PRODUCT_IMAGE_PREFIX}${image.slice(LEGACY_PRODUCT_IMAGE_PREFIX.length)}`
  }
  return image
}

function absoluteImageUrl(value, apiBaseUrl) {
  let image = formalProductImagePath(value)
  const baseUrl = apiBaseUrl || serverSync.apiBaseUrl()
  const origin = String(baseUrl).match(/^https?:\/\/[^/]+/)
  const hostedProductImage = image.match(/^https?:\/\/[^/]+\/(?:pingping-admin-api|admin-api)\/v1\/product-images\/(.+)$/)
  if (origin && hostedProductImage) return `${origin[0]}${PRODUCT_IMAGE_PREFIX}${hostedProductImage[1]}`
  if (!image || /^https?:\/\//.test(image)) return image
  return origin ? `${origin[0]}${image.startsWith('/') ? '' : '/'}${image}` : image
}

function refreshProducts() {
  if (!auth.getCurrentUser()) return Promise.resolve(false)
  if (inFlight) return inFlight
  inFlight = serverSync.pullProducts()
    .then(result => {
      const items = (result.items || []).map(item => ({ ...item, image: absoluteImageUrl(item.image) }))
      store.replaceProductsFromCatalog(items)
      return true
    })
    .catch(error => {
      if (error.statusCode === 401 || error.statusCode === 403) {
        auth.logout()
        wx.reLaunch({ url: '/pages/login/index' })
      }
      throw error
    })
    .finally(() => { inFlight = null })
  return inFlight
}

module.exports = { refreshProducts, absoluteImageUrl }
