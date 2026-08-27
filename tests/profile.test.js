const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const storage = {}
const calls = { modals: [], navigations: [], relaunches: [], toasts: [] }
let requestMode = 'success'
let pageDefinition = null

global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key) { delete storage[key] },
  showModal(options) { calls.modals.push(options) },
  navigateTo(options) { calls.navigations.push(options) },
  reLaunch(options) { calls.relaunches.push(options) },
  showToast(options) { calls.toasts.push(options) },
  request(options) {
    if (requestMode === 'failure') {
      options.fail({ errMsg: 'network unavailable' })
      return
    }
    options.success({
      statusCode: 200,
      data: { ok: true, exists: true, state: { products: [], operations: [] }, revision: 3 }
    })
  }
}
global.Page = definition => { pageDefinition = definition }

const profile = require('../utils/profile')
const serverSync = require('../utils/server-sync')
const auth = require('../utils/auth')
require('../pages/profile/index')

function resetCalls() {
  Object.keys(calls).forEach(key => { calls[key].length = 0 })
}

function createPage() {
  const page = { ...pageDefinition, data: JSON.parse(JSON.stringify(pageDefinition.data)) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

test('有昵称时展示真实昵称', () => {
  assert.equal(profile.buildUserView({ name: '萍萍' }).name, '萍萍')
})

test('无昵称时稳妥显示“用户”', () => {
  assert.equal(profile.buildUserView({ name: '  ' }).name, '用户')
})

test('有头像时使用真实头像地址', () => {
  const view = profile.buildUserView({ avatarUrl: 'https://example.test/avatar.jpg' })
  assert.equal(view.hasAvatar, true)
  assert.equal(view.avatarUrl, 'https://example.test/avatar.jpg')
})

test('无头像时提供文字头像兜底', () => {
  const view = profile.buildUserView({ name: '萍萍', avatarUrl: '' })
  assert.equal(view.hasAvatar, false)
  assert.equal(view.avatarText, '萍')
})

test('只有可靠角色值才显示身份', () => {
  assert.equal(profile.buildUserView({ role: 'admin' }).roleLabel, '管理员')
  assert.equal(profile.buildUserView({ role: 'unknown-role' }).roleLabel, '')
  assert.equal(profile.buildUserView({}).roleLabel, '')
})

test('真实同步成功状态显示已同步及可靠时间', () => {
  const view = profile.buildSyncView({ state: 'synced', lastSyncAt: '2026-08-19T01:32:00.000Z' })
  assert.equal(view.label, '已同步')
  assert.match(view.detail, /^最近同步 \d{2}:\d{2}$/)
})

test('同步队列存在时显示待同步', () => {
  assert.equal(profile.buildSyncView({ state: 'pending' }).label, '待同步')
})

test('同步失败时显示失败并提供重试', () => {
  const view = profile.buildSyncView({ state: 'failed' })
  assert.equal(view.label, '同步失败')
  assert.equal(view.canRetry, true)
})

test('server-sync 的成功、待同步与失败来自真实队列状态', async () => {
  storage.shuishui_wechat_session_v1 = { openid: 'openid-test', token: 'token-test' }
  serverSync.resetSyncState()
  requestMode = 'success'
  await serverSync.pullState()
  assert.equal(serverSync.getSyncStatus().state, 'synced')

  serverSync.queuePush({ products: [], operations: [] })
  assert.equal(serverSync.getSyncStatus().state, 'pending')

  requestMode = 'failure'
  assert.equal(await serverSync.retryPendingPush(), false)
  assert.equal(serverSync.getSyncStatus().state, 'failed')
  serverSync.resetSyncState()
  requestMode = 'success'
})

test('操作记录入口进入已注册页面', () => {
  resetCalls()
  createPage().openOperations()
  assert.deepEqual(calls.navigations[0], { url: '/pages/operations/index?source=profile' })
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'))
  assert.equal(appConfig.pages.includes('pages/operations/index'), true)
})

test('管理后台入口仅展示普通说明', () => {
  resetCalls()
  createPage().showAdminConsole()
  assert.equal(calls.navigations.length, 0)
  assert.match(calls.modals[0].content, /电脑浏览器.*正式管理后台/)
  assert.equal(calls.modals[0].showCancel, false)
  assert.equal(calls.modals[0].confirmText, '知道了')
})

test('页面版本来自明确的 1.0.1 应用常量', () => {
  assert.equal(profile.APP_VERSION, '1.0.1')
  assert.equal(pageDefinition.data.version, profile.APP_VERSION)
})

test('退出登录取消后不清理会话也不跳转', () => {
  resetCalls()
  storage.shuishui_wechat_session_v1 = { openid: 'openid-test', token: 'token-test' }
  const page = createPage()
  page.logoutAccount()
  assert.equal(calls.modals[0].content, '确定要退出登录吗？')
  calls.modals[0].success({ cancel: true })
  assert.ok(storage.shuishui_wechat_session_v1)
  assert.equal(calls.relaunches.length, 0)
})

test('确认退出只清认证会话，保留经营数据并返回登录页', () => {
  resetCalls()
  storage.shuishui_wechat_session_v1 = { openid: 'openid-test', token: 'token-test' }
  storage.clothing_inventory_state_v2 = {
    version: 10,
    products: [{ id: 'product-1' }],
    operations: [{ id: 'operation-1' }],
    purchases: [{ id: 'purchase-1' }],
    sales: [{ id: 'sale-1' }],
    manualProfits: [{ id: 'ledger-1' }]
  }
  const page = createPage()
  page.logoutAccount()
  calls.modals[0].success({ confirm: true })
  assert.equal(auth.getCurrentUser(), null)
  assert.equal(storage.shuishui_wechat_session_v1, undefined)
  assert.equal(storage.clothing_inventory_state_v2.products[0].id, 'product-1')
  assert.equal(storage.clothing_inventory_state_v2.operations[0].id, 'operation-1')
  assert.deepEqual(calls.relaunches[0], { url: '/pages/login/index' })
})

test('关于内容保持简洁并覆盖当前主要经营功能', () => {
  resetCalls()
  createPage().showAbout()
  assert.equal(calls.modals[0].title, '关于萍萍小助手')
  assert.match(calls.modals[0].content, /商品、库存、卖货、拿货、账本/)
})

test('我的页面移除旧只读定位冲突文案', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'index.wxml'), 'utf8')
  assert.doesNotMatch(source, /只读端|经营管理请使用网页管理后台|小程序只能查看/)
})
