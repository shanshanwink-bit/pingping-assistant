const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { test } = require('node:test')

const { createRequestHandler, commitStoreTransaction } = require('../server/src/app')
const { loadConfig } = require('../server/src/config')
const { signToken, verifyToken } = require('../server/src/token')

const JWT_SECRET = 'demo-experience-test-secret-longer-than-thirty-two-characters'
const DEMO_STORE_ID = '10000000-0000-4000-8000-000000000001'
const DEMO_USER_ID = '20000000-0000-4000-8000-000000000001'
const REAL_STORE_ID = '00000000-0000-4000-8000-000000000001'

function config(overrides = {}) {
  const result = loadConfig({
    MYSQL_DATABASE: 'test',
    MYSQL_USER: 'test',
    MYSQL_PASSWORD: 'test',
    JWT_SECRET,
    PRIMARY_STORE_ID: REAL_STORE_ID,
    WECHAT_ALLOWED_OPENIDS: 'real-owner-openid',
    DEMO_LOGIN_ENABLED: 'true',
    DEMO_STORE_ID,
    DEMO_USER_ID,
    ...overrides
  })
  return { ...result, jwtSecret: JWT_SECRET }
}

function apiPool() {
  const calls = []
  const pool = {
    async execute(sql, args) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      calls.push({ sql: normalized, args: [...args] })
      if (normalized.includes('FROM users u')) {
        return [[{
          id: DEMO_USER_ID,
          display_name: '体验账号',
          avatar_url: '',
          role: 'clerk',
          store_name: '萍萍体验店'
        }]]
      }
      if (normalized.includes('FROM store_members sm')) {
        if (args[0] === DEMO_USER_ID && args[1] === DEMO_STORE_ID) {
          return [[{ role: 'clerk', store_name: '萍萍体验店' }]]
        }
        return [[]]
      }
      if (normalized.startsWith('SELECT state, revision, updated_at FROM store_states')) {
        return [[{ state: demoState(), revision: 3, updated_at: '2026-08-26 10:00:00' }]]
      }
      if (normalized.includes('FROM admin_products')) {
        return [[{
          id: 81, name: '提花针织短外套', code: 'DEMO-FW2601', item_number: 'PP-D2601',
          item_number_managed: 1, business_type: '服装', category: '外套', spec_count: 4,
          stock: 12, cost_price: 86, low_stock_threshold: 3, price: 199, status: '销售中',
          image_url: '', updated_at: '2026-08-26 10:00:00'
        }]]
      }
      throw new Error(`unexpected query: ${normalized}`)
    }
  }
  return { pool, calls }
}

async function invoke(handler, method, path, options = {}) {
  const body = options.body === undefined ? '' : JSON.stringify(options.body)
  const request = Readable.from(body ? [Buffer.from(body)] : [])
  request.method = method
  request.url = path
  request.headers = { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }
  let statusCode = 0
  let responseBody = ''
  const response = {
    writeHead(status) { statusCode = status },
    end(value) { responseBody = value || '' }
  }
  await handler(request, response)
  return { statusCode, body: responseBody ? JSON.parse(responseBody) : {} }
}

function demoState(stock = 5) {
  return {
    version: 10,
    currentUser: { id: DEMO_USER_ID, name: '体验账号', role: 'clerk', storeId: DEMO_STORE_ID, demo: true },
    products: [{
      id: 'demo-coat', adminProductId: 81, name: '提花针织短外套',
      businessType: 'clothing', salePrice: 199, costPrice: 86,
      specs: [{ id: 'demo-coat-m', color: '米白', size: 'M', stock }]
    }],
    suppliers: [], brands: [], operations: [], purchases: [], sales: [], manualProfits: []
  }
}

test('体验登录默认关闭且启用时必须固定配置 Demo 店和 Demo 用户', () => {
  const disabled = loadConfig({
    MYSQL_DATABASE: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'test', JWT_SECRET
  })
  assert.equal(disabled.demo.enabled, false)
  assert.throws(() => loadConfig({
    MYSQL_DATABASE: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'test', JWT_SECRET,
    DEMO_LOGIN_ENABLED: 'true'
  }), /DEMO_STORE_ID 和 DEMO_USER_ID/)
})

test('demo login 成功且忽略客户端提交的真实 storeId', async () => {
  const { pool, calls } = apiPool()
  const handler = createRequestHandler(pool, config())
  const result = await invoke(handler, 'POST', '/api/v1/auth/demo/login', {
    body: { storeId: REAL_STORE_ID, role: 'owner', demo: false }
  })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.user.demo, true)
  assert.equal(result.body.user.storeId, DEMO_STORE_ID)
  assert.equal(result.body.user.role, 'clerk')
  const payload = verifyToken(result.body.token, JWT_SECRET)
  assert.equal(payload.demo, true)
  assert.equal(payload.storeId, DEMO_STORE_ID)
  assert.deepEqual(calls[0].args, [DEMO_USER_ID, DEMO_STORE_ID])
})

test('demo session 固定绑定 Demo 店且伪造其他门店范围会被拒绝', async () => {
  const { pool, calls } = apiPool()
  const handler = createRequestHandler(pool, config())
  const login = await invoke(handler, 'POST', '/api/v1/auth/demo/login')
  const session = await invoke(handler, 'GET', '/api/v1/session', { token: login.body.token })
  assert.equal(session.statusCode, 200)
  assert.equal(session.body.membership.demo, true)
  assert.equal(session.body.membership.storeId, DEMO_STORE_ID)
  assert.deepEqual(calls.find(call => call.sql.includes('FROM store_members sm')).args, [DEMO_USER_ID, DEMO_STORE_ID])

  const wrongStoreToken = signToken({
    userId: DEMO_USER_ID, storeId: REAL_STORE_ID, role: 'clerk', demo: true
  }, JWT_SECRET, 60)
  const rejected = await invoke(handler, 'GET', '/api/v1/session', { token: wrongStoreToken })
  assert.equal(rejected.statusCode, 403)
  assert.match(rejected.body.message, /体验凭证无权访问/)
})

test('demo 可以查看 Demo 商品且查询不接触真实门店', async () => {
  const { pool, calls } = apiPool()
  const handler = createRequestHandler(pool, config())
  const login = await invoke(handler, 'POST', '/api/v1/auth/demo/login')
  const result = await invoke(handler, 'GET', '/api/v1/catalog/products', { token: login.body.token })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.items[0].name, '提花针织短外套')
  const catalogCall = calls.find(call => call.sql.includes('FROM admin_products'))
  assert.deepEqual(catalogCall.args, [DEMO_STORE_ID])
})

test('Node Demo API 不暴露员工、设置、导出和永久删除入口', async () => {
  const { pool } = apiPool()
  const handler = createRequestHandler(pool, config())
  const login = await invoke(handler, 'POST', '/api/v1/auth/demo/login')
  for (const [method, path] of [
    ['GET', '/api/v1/employees'],
    ['PATCH', '/api/v1/settings/demo'],
    ['GET', '/api/v1/export'],
    ['DELETE', '/api/v1/catalog/products/81']
  ]) {
    const result = await invoke(handler, method, path, { token: login.body.token, body: {} })
    assert.equal(result.statusCode, 404, `${method} ${path} should not exist`)
  }
})

test('Demo clerk 即使篡改 token 角色也不能绕过 owner 权限编辑商品资料', async () => {
  const { pool, calls } = apiPool()
  const handler = createRequestHandler(pool, config())
  const forgedOwnerToken = signToken({
    userId: DEMO_USER_ID, storeId: DEMO_STORE_ID, role: 'owner', demo: true
  }, JWT_SECRET, 60)
  const result = await invoke(handler, 'PATCH', '/api/v1/catalog/products/81', {
    token: forgedOwnerToken,
    body: {
      name: '不应写入的商品名', itemNumber: 'FORBIDDEN', category: '外套',
      salePrice: 199, costPrice: 86, status: '销售中'
    }
  })

  assert.equal(result.statusCode, 403)
  assert.match(result.body.message, /仅店主/)
  assert.equal(calls.some(call => call.sql.startsWith('UPDATE admin_products')), false)
})

test('Web 面试店员账号由服务端禁止员工、设置和永久删除且前端禁止导出', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(__dirname, '..')
  const service = fs.readFileSync(path.join(root, 'server-go/internal/service/admin.go'), 'utf8') +
    fs.readFileSync(path.join(root, 'server-go/internal/service/business.go'), 'utf8')
  const productsView = fs.readFileSync(path.join(root, 'admin/src/views/ProductsView.vue'), 'utf8')
  const dashboardView = fs.readFileSync(path.join(root, 'admin/src/views/DashboardView.vue'), 'utf8')
  const analysisView = fs.readFileSync(path.join(root, 'admin/src/views/AnalysisView.vue'), 'utf8')

  assert.match(service, /Can\(actor, "system\.staff\.manage"\)/)
  assert.match(service, /Can\(actor, "system\.settings\.manage"\)/)
  assert.match(service, /actor\.Role != "owner"/)
  assert.match(productsView, /canAccess\(props\.currentUser,'products\.export'\)/)
  assert.match(dashboardView, /canAccess\(props\.currentUser, 'reports\.export'\)/)
  assert.match(analysisView, /canAccess\(props\.currentUser, 'reports\.export'\)/)
})

function transactionPool() {
  const states = new Map([
    [DEMO_STORE_ID, demoState(5)],
    [REAL_STORE_ID, demoState(99)]
  ])
  const revisions = new Map([[DEMO_STORE_ID, 2], [REAL_STORE_ID, 7]])
  const writes = []
  return {
    states,
    writes,
    async getConnection() {
      let pending = null
      return {
        async beginTransaction() {},
        async execute(sql, args) {
          const normalized = sql.replace(/\s+/g, ' ').trim()
          if (normalized.startsWith('SELECT state, revision FROM store_states')) {
            const storeId = args[0]
            return [[{ state: JSON.stringify(states.get(storeId)), revision: revisions.get(storeId) }]]
          }
          if (normalized.startsWith('SELECT status FROM admin_products')) {
            writes.push({ kind: 'product-read', storeId: args[1] })
            return [[{ status: '销售中' }]]
          }
          if (normalized.startsWith('UPDATE store_states')) {
            pending = { storeId: args[3], state: JSON.parse(args[0]), revision: Number(args[1]) }
            writes.push({ kind: 'state', storeId: args[3] })
            return [{ affectedRows: 1 }]
          }
          if (normalized.startsWith('UPDATE admin_products')) {
            writes.push({ kind: 'product-write', storeId: args[4] })
            return [{ affectedRows: 1 }]
          }
          if (normalized.startsWith('INSERT INTO audit_logs')) {
            writes.push({ kind: 'audit', storeId: args[0] })
            return [{ affectedRows: 1 }]
          }
          throw new Error(`unexpected transaction query: ${normalized}`)
        },
        async commit() {
          states.set(pending.storeId, pending.state)
          revisions.set(pending.storeId, pending.revision)
        },
        async rollback() { pending = null },
        release() {}
      }
    }
  }
}

test('demo 可以在 Demo 店卖货和拿货且不会影响真实门店', async () => {
  const pool = transactionPool()
  const membership = { storeId: DEMO_STORE_ID, userId: DEMO_USER_ID, role: 'clerk', demo: true }
  await commitStoreTransaction(pool, membership, 'sale', {
    transactionId: 'demo-sale-1', productId: 'demo-coat', specId: 'demo-coat-m', quantity: 1, unitPrice: 199
  }, 'request-demo-sale')
  await commitStoreTransaction(pool, membership, 'purchase', {
    transactionId: 'demo-purchase-1', productId: 'demo-coat', specId: 'demo-coat-m', quantity: 2, unitCost: 88
  }, 'request-demo-purchase')

  assert.equal(pool.states.get(DEMO_STORE_ID).products[0].specs[0].stock, 6)
  assert.equal(pool.states.get(DEMO_STORE_ID).sales.length, 1)
  assert.equal(pool.states.get(DEMO_STORE_ID).purchases.length, 1)
  assert.equal(pool.states.get(REAL_STORE_ID).products[0].specs[0].stock, 99)
  assert.ok(pool.writes.every(write => write.storeId === DEMO_STORE_ID))
})
