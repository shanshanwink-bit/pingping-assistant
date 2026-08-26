const assert = require('assert')

const storage = {}
let serverState = null
let serverRevision = 0
let environmentVersion = 'release'

global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key) { delete storage[key] },
  getAccountInfoSync() { return { miniProgram: { envVersion: environmentVersion } } },
  login(options) {
    options.success({ code: 'wechat_code_test' })
  },
  request(options) {
    const path = new URL(options.url).pathname
    if (options.method === 'POST' && path.endsWith('/auth/wechat/login')) {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          token: 'server-token-test',
          user: {
            id: 'user-test-owner',
            openid: 'openid_test_owner',
            unionid: '',
            name: options.data.profile.name,
            avatarUrl: options.data.profile.avatarUrl || '',
            role: 'owner',
            storeId: 'store-test',
            storeName: '测试店铺'
          }
        }
      })
      return
    }
    if (options.method === 'GET' && path.endsWith('/store/state')) {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          exists: Boolean(serverState),
          state: serverState,
          revision: serverRevision
        }
      })
      return
    }
    if (options.method === 'PUT' && path.endsWith('/store/state')) {
      if (Number(options.data.revision) !== serverRevision) {
        options.success({ statusCode: 409, data: { ok: false, message: '版本冲突' } })
        return
      }
      serverState = JSON.parse(JSON.stringify(options.data.state))
      serverRevision += 1
      options.success({ statusCode: 200, data: { ok: true, revision: serverRevision } })
      return
    }
    options.success({ statusCode: 404, data: { ok: false, message: 'unexpected request' } })
  }
}

const auth = require('../utils/auth')
const serverSync = require('../utils/server-sync')
const store = require('../utils/store')

async function run() {
  storage.pingping_api_base_url_v1 = 'http://106.13.176.125/api/v1'
  const connection = await serverSync.initServer()
  assert.strictEqual(connection.baseUrl, 'https://shanshanwink.online/pingping-api/v1')
  assert.strictEqual(storage.pingping_api_base_url_v1, undefined, '正式版应清理旧 HTTP IP 覆盖')

  environmentVersion = 'develop'
  storage.pingping_api_base_url_v1 = 'http://127.0.0.1:3300/api/v1'
  assert.strictEqual(serverSync.apiBaseUrl(), 'http://127.0.0.1:3300/api/v1')
  delete storage.pingping_api_base_url_v1
  environmentVersion = 'release'
  assert.strictEqual(auth.getCurrentUser(), null)

  storage.shuishui_wechat_session_v1 = { openid: 'legacy-cloud-openid' }
  assert.strictEqual(auth.getCurrentUser(), null)
  delete storage.shuishui_wechat_session_v1

  store.ensureState()
  const product = store.addProduct({
    businessType: 'clothing',
    name: '服务器登录测试商品',
    category: '上衣',
    costPrice: 10,
    salePrice: 20,
    lowStockThreshold: 1,
    specs: [{ color: '蓝色', size: 'M', stock: 3 }]
  })

  const user = await auth.loginWithWechat({ name: '水水店主' })
  assert.strictEqual(user.openid, 'openid_test_owner')
  assert.strictEqual(user.name, '水水店主')
  assert.strictEqual(user.storeId, 'store-test')
  assert.strictEqual(auth.canEditProducts(), true)
  const ownerSession = storage.shuishui_wechat_session_v1
  storage.shuishui_wechat_session_v1 = { ...ownerSession, role: 'admin' }
  assert.strictEqual(auth.canEditProducts(), false)
  storage.shuishui_wechat_session_v1 = ownerSession
  store.setCurrentUser(user)
  await serverSync.pushState(store.getState())
  assert.strictEqual(serverState.products[0].id, product.id)
  assert.strictEqual(serverState.currentUser.id, user.id)

  auth.logout()
  assert.strictEqual(auth.getCurrentUser(), null)
  assert.strictEqual(storage.shuishui_wechat_session_v1, undefined)
  assert.ok(storage.clothing_inventory_state_v2)
  assert.strictEqual(store.getProduct(product.id).totalStock, 3)

  const loggedInAgain = await auth.loginWithWechat({ name: '水水店主' })
  const remote = await serverSync.pullState()
  assert.strictEqual(remote.exists, true)
  assert.strictEqual(remote.revision, 1)
  store.replaceStateFromServer(remote.state, loggedInAgain)
  assert.strictEqual(store.getProduct(product.id).totalStock, 3)
  assert.strictEqual(store.getState().currentUser.account, 'openid_test_owner')

  serverSync.resetSyncState()
  console.log('wechat self-hosted login and sync: PASS')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
