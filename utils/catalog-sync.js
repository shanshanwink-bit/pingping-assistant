const auth = require('./auth')
const serverSync = require('./server-sync')
const store = require('./store')

let inFlight = null

function absoluteImageUrl(value) {
  const image = String(value || '')
  if (!image || /^https?:\/\//.test(image)) return image
  const origin = serverSync.apiBaseUrl().match(/^https?:\/\/[^/]+/)
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

module.exports = { refreshProducts }
