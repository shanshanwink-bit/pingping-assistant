const assert = require('assert')

const storage = {}
let cloudState = null
let cloudInitialized = false
let sharedCloudOptions = null

function callFunction({ name, data }) {
  if (name === 'login') {
    return Promise.resolve({ result: { openid: 'openid_test_owner', appid: 'wx_test_current_app' } })
  }
  if (name === 'store-sync' && data.action === 'pull') {
    return Promise.resolve({ result: { ok: true, exists: Boolean(cloudState), state: cloudState } })
  }
  if (name === 'store-sync' && data.action === 'push') {
    cloudState = JSON.parse(JSON.stringify(data.state))
    return Promise.resolve({ result: { ok: true } })
  }
  return Promise.resolve({ result: { ok: false, message: 'unexpected call' } })
}

global.wx = {
  getAccountInfoSync() {
    return { miniProgram: { appId: 'wx_test_current_app' } }
  },
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key) { delete storage[key] },
  cloud: {
    Cloud: class {
      constructor(options) {
        sharedCloudOptions = options
      }
      init() {
        cloudInitialized = true
        return Promise.resolve()
      }
      callFunction(options) {
        return callFunction(options)
      }
    },
    init() { cloudInitialized = true },
    callFunction
  }
}

const auth = require('../utils/auth')
const cloudSync = require('../utils/cloud-sync')
const store = require('../utils/store')

async function run() {
  await cloudSync.initCloud()
  assert.strictEqual(cloudInitialized, true)
  assert.strictEqual(sharedCloudOptions, null)
  assert.strictEqual(auth.getCurrentUser(), null)

  store.ensureState()
  const product = store.addProduct({
    businessType: 'clothing',
    name: '云登录测试商品',
    category: '上衣',
    costPrice: 10,
    salePrice: 20,
    lowStockThreshold: 1,
    specs: [{ color: '蓝色', size: 'M', stock: 3 }]
  })

  const user = await auth.loginWithWechat({ name: '水水店主' })
  assert.strictEqual(user.openid, 'openid_test_owner')
  assert.strictEqual(user.name, '水水店主')
  store.setCurrentUser(user)
  await cloudSync.pushState(store.getState())
  assert.strictEqual(cloudState.products[0].id, product.id)
  assert.strictEqual(cloudState.currentUser.id, user.id)

  auth.logout()
  assert.strictEqual(auth.getCurrentUser(), null)
  assert.strictEqual(store.getProduct(product.id).totalStock, 3)

  const loggedInAgain = await auth.loginWithWechat({ name: '水水店主' })
  const remote = await cloudSync.pullState()
  assert.strictEqual(remote.exists, true)
  store.replaceStateFromCloud(remote.state, loggedInAgain)
  assert.strictEqual(store.getProduct(product.id).totalStock, 3)
  assert.strictEqual(store.getState().currentUser.account, 'openid_test_owner')

  console.log('wechat cloud login and sync: PASS')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
