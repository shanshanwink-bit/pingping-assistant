const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const DEMO_STORE_ID = '10000000-0000-4000-8000-000000000001'
const DEMO_USER_ID = '20000000-0000-4000-8000-000000000001'
const REAL_STORE_ID = '00000000-0000-4000-8000-000000000001'

function demoState() {
  return {
    version: 10,
    currentUser: { id: DEMO_USER_ID, name: '体验账号', role: 'clerk', storeId: DEMO_STORE_ID, demo: true },
    products: [], suppliers: [], brands: [], operations: [], purchases: [], sales: [], manualProfits: []
  }
}

test('小程序体验入口绑定真实事件、禁止 Demo 离线降级并隔离本地门店缓存', async () => {
  const root = path.resolve(__dirname, '..')
  const template = fs.readFileSync(path.join(root, 'pages/login/index.wxml'), 'utf8')
  const page = fs.readFileSync(path.join(root, 'pages/login/index.js'), 'utf8')
  assert.match(template, /bindtap="submitDemoLogin"/)
  assert.match(template, />\{\{demoSubmitting \? '正在进入体验店' : '体验一下'\}\}<\/button>/)
  assert.doesNotMatch(template, /aria-disabled="true"/)
  assert.match(page, /if \(user\.demo\) throw new Error\('体验店尚未初始化/)
  assert.match(page, /!user\.demo && store\.isStateForStore\(user\.storeId\)/)
  assert.match(page, /已进入萍萍体验店/)
  assert.doesNotMatch(page, /面试体验店/)

  const storage = {}
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
    removeStorageSync(key) { delete storage[key] },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } } },
    request(options) {
      const requestPath = new URL(options.url).pathname
      if (requestPath.endsWith('/auth/demo/login')) {
        options.success({ statusCode: 200, data: { ok: true, token: 'demo-token', user: {
          id: DEMO_USER_ID, name: '体验账号', role: 'clerk', storeId: DEMO_STORE_ID,
          storeName: '萍萍体验店', demo: true
        } } })
        return
      }
      options.success({ statusCode: 404, data: { ok: false, message: 'unexpected request' } })
    }
  }
  const auth = require('../utils/auth')
  const store = require('../utils/store')

  storage.shuishui_wechat_session_v1 = {
    token: 'legacy-demo-token', id: DEMO_USER_ID, account: 'demo',
    name: '面试体验账号', storeName: '萍萍小助手面试体验店',
    role: 'clerk', storeId: DEMO_STORE_ID, demo: true
  }
  const migratedUser = auth.getCurrentUser()
  assert.equal(migratedUser.name, '体验账号')
  assert.equal(migratedUser.account, '体验账号')
  assert.equal(migratedUser.storeName, '萍萍体验店')
  auth.logout()

  const user = await auth.loginDemo()
  assert.equal(user.demo, true)
  assert.equal(user.storeId, DEMO_STORE_ID)
  assert.equal(user.role, 'clerk')
  assert.equal(user.name, '体验账号')
  assert.equal(user.account, '体验账号')
  assert.equal(user.storeName, '萍萍体验店')
  assert.equal(auth.canEditProducts(), false)
  const authSource = fs.readFileSync(path.join(root, 'utils/auth.js'), 'utf8')
  const ownerGate = authSource.match(/function canEditProducts\(\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(ownerGate, /role === 'owner'/)
  assert.doesNotMatch(ownerGate, /demo/)
  store.replaceStateFromServer(demoState(), user)
  assert.equal(store.isStateForStore(DEMO_STORE_ID), true)
  assert.equal(store.canInitializeStoreFromCache(REAL_STORE_ID), false)
  auth.logout()
  assert.equal(auth.getCurrentUser(), null)
  assert.equal(storage.shuishui_wechat_session_v1, undefined)
})
