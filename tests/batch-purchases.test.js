const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const { createRequestHandler } = require('../server/src/app')
const {
  commitPurchaseBatch,
  derivePurchaseTransactionId,
  normalizeBatchRequest
} = require('../server/src/batch-purchases')
const { loadConfig } = require('../server/src/config')
const { signToken } = require('../server/src/token')

const JWT_SECRET = 'batch-purchase-test-secret-longer-than-thirty-two-characters'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function state() {
  return {
    products: [
      {
        id: 'water', adminProductId: 8, name: '爽肤水', businessType: 'cosmetics',
        salePrice: 100, costPrice: 50,
        specs: [
          { id: 'water-100', color: '通用', size: '100ml', stock: 2 },
          { id: 'water-200', color: '通用', size: '200ml', stock: 3 }
        ]
      },
      {
        id: 'coat', adminProductId: 9, name: '针织开衫', businessType: 'clothing',
        salePrice: 120, costPrice: 20,
        specs: [{ id: 'coat-m', color: '白色', size: 'M', stock: 1 }]
      }
    ],
    operations: [], purchases: [], sales: [], manualProfits: [],
    currentUser: { id: 'user-1', name: '萍萍' }
  }
}

function batch(overrides) {
  return {
    batchTransactionId: 'ai-batch-001',
    supplier: '测试供应商',
    note: '采购单 PO-001',
    items: [
      { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 2, unitCost: 60 },
      { lineId: 'line-2', productId: 'coat', specId: 'coat-m', quantity: 3, unitCost: 30 }
    ],
    ...overrides
  }
}

function createDatabase(initialState, options = {}) {
  const database = {
    state: clone(initialState),
    revision: 4,
    audits: [],
    adminUpdates: [],
    storeUpdates: 0,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    connectionCount: 0
  }
  let lock = Promise.resolve()

  async function acquire() {
    const previous = lock
    let release
    lock = new Promise(resolve => { release = resolve })
    await previous
    return release
  }

  const pool = {
    async getConnection() {
      database.connectionCount += 1
      let unlock = null
      let pendingState = null
      let pendingRevision = null
      let pendingAudits = []
      let pendingAdminUpdates = []
      let pendingStoreUpdates = 0
      return {
        async beginTransaction() {
          unlock = await acquire()
          database.beginCount += 1
        },
        async execute(sql, args) {
          const normalized = sql.replace(/\s+/g, ' ').trim()
          if (normalized.startsWith('SELECT state, revision FROM store_states')) {
            return [[{ state: JSON.stringify(database.state), revision: database.revision }]]
          }
          if (normalized.startsWith('SELECT status FROM admin_products')) {
            const productId = Number(args[0])
            return [[{ status: Number(options.inactiveAdminProductId || 0) === productId ? '已停用' : '销售中' }]]
          }
          if (normalized.startsWith('UPDATE store_states')) {
            pendingStoreUpdates += 1
            if (options.failStateUpdate) return [{ affectedRows: 0 }]
            pendingState = JSON.parse(args[0])
            pendingRevision = Number(args[1])
            return [{ affectedRows: 1 }]
          }
          if (normalized.startsWith('UPDATE admin_products')) {
            const update = {
              stock: Number(args[0]), costPrice: Number(args[1]), price: Number(args[2]),
              productId: Number(args[3]), storeId: args[4]
            }
            pendingAdminUpdates.push(update)
            if (Number(options.failAdminProductId || 0) === update.productId) return [{ affectedRows: 0 }]
            return [{ affectedRows: 1 }]
          }
          if (normalized.startsWith('INSERT INTO audit_logs')) {
            if (options.failAuditAt === pendingAudits.length + 1) throw new Error('audit failed')
            pendingAudits.push({
              storeId: args[0], userId: args[1], action: args[2], targetType: args[3],
              targetId: args[4], requestId: args[5], details: JSON.parse(args[6])
            })
            return [{ affectedRows: 1 }]
          }
          throw new Error(`unexpected query: ${normalized}`)
        },
        async commit() {
          if (pendingState) {
            database.state = pendingState
            database.revision = pendingRevision
          }
          database.storeUpdates += pendingStoreUpdates
          database.audits.push(...pendingAudits)
          database.adminUpdates.push(...pendingAdminUpdates)
          database.commitCount += 1
          if (unlock) unlock()
          unlock = null
        },
        async rollback() {
          database.rollbackCount += 1
          pendingState = null
          pendingAudits = []
          pendingAdminUpdates = []
          pendingStoreUpdates = 0
          if (unlock) unlock()
          unlock = null
        },
        release() {
          if (unlock) unlock()
          unlock = null
        }
      }
    }
  }
  return { database, pool }
}

const membership = { storeId: 'store-1', userId: 'user-1', role: 'owner' }

function apiConfig() {
  const config = loadConfig({
    MYSQL_DATABASE: 'test',
    MYSQL_USER: 'test',
    MYSQL_PASSWORD: 'test',
    JWT_SECRET
  })
  return { ...config, jwtSecret: JWT_SECRET }
}

async function invokeBatchApi(handler, payload, token) {
  const request = Readable.from([Buffer.from(JSON.stringify(payload))])
  request.method = 'POST'
  request.url = '/api/v1/store/purchases/batch'
  request.headers = token ? {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  } : { 'content-type': 'application/json' }
  let statusCode = 0
  let responseBody = ''
  const response = {
    writeHead(status) { statusCode = status },
    end(value) { responseBody = value || '' }
  }
  await handler(request, response)
  return { statusCode, body: responseBody ? JSON.parse(responseBody) : {} }
}

test('两行采购在一个事务中成功并只更新一次 store_states', async () => {
  const { database, pool } = createDatabase(state())
  const result = await commitPurchaseBatch(pool, membership, batch(), 'request-1', new Date('2026-08-22T02:00:00Z'))

  assert.equal(result.duplicate, false)
  assert.equal(result.transactions.length, 2)
  assert.equal(result.revision, 5)
  assert.equal(database.state.products[0].specs[0].stock, 4)
  assert.equal(database.state.products[1].specs[0].stock, 4)
  assert.equal(database.storeUpdates, 1)
  assert.equal(database.commitCount, 1)
  assert.equal(database.rollbackCount, 0)
})

test('同一商品多个规格成功且后台聚合商品只更新一次', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch({ items: [
    { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 2, unitCost: 60 },
    { lineId: 'line-2', productId: 'water', specId: 'water-200', quantity: 1, unitCost: 70 }
  ] })
  await commitPurchaseBatch(pool, membership, request, 'request-2')

  assert.equal(database.state.products[0].specs[0].stock, 4)
  assert.equal(database.state.products[0].specs[1].stock, 4)
  assert.equal(database.adminUpdates.length, 1)
  assert.equal(database.adminUpdates[0].stock, 8)
})

test('批量采购逐行沿用加权平均成本规则', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch({ items: [
    { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 5, unitCost: 70 }
  ] })
  await commitPurchaseBatch(pool, membership, request, 'request-3')

  assert.equal(database.state.products[0].costPrice, 60)
  assert.equal(database.adminUpdates[0].costPrice, 60)
})

test('每一行生成采购记录和入库操作记录', async () => {
  const { database, pool } = createDatabase(state())
  await commitPurchaseBatch(pool, membership, batch(), 'request-4')

  assert.equal(database.state.purchases.length, 2)
  assert.equal(database.state.operations.length, 2)
  assert.ok(database.state.purchases.every(record => record.supplier === '测试供应商'))
  assert.ok(database.state.operations.every(operation => operation.type === 'inbound'))
  assert.ok(database.state.operations.every(operation => operation.referenceType === 'purchase'))
})

test('每一行生成带批次信息的 audit 日志', async () => {
  const { database, pool } = createDatabase(state())
  await commitPurchaseBatch(pool, membership, batch(), 'request-audit')

  assert.equal(database.audits.length, 2)
  assert.ok(database.audits.every(log => log.action === 'miniapp.purchase.create'))
  assert.ok(database.audits.every(log => log.requestId === 'request-audit'))
  assert.deepEqual(database.audits.map(log => log.details.lineId).sort(), ['line-1', 'line-2'])
  assert.ok(database.audits.every(log => log.details.batchTransactionId === 'ai-batch-001'))
})

test('任意一行失败时整体回滚且前一行不会部分成功', async () => {
  const original = state()
  const { database, pool } = createDatabase(original)
  const request = batch({ items: [
    { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 2, unitCost: 60 },
    { lineId: 'line-2', productId: 'missing', specId: 'missing-spec', quantity: 1, unitCost: 20 }
  ] })

  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, request, 'request-rollback'),
    error => error.statusCode === 404
  )
  assert.deepEqual(database.state, original)
  assert.equal(database.storeUpdates, 0)
  assert.equal(database.adminUpdates.length, 0)
  assert.equal(database.audits.length, 0)
  assert.equal(database.commitCount, 0)
  assert.equal(database.rollbackCount, 1)
})

test('批量采购包含停用商品时整批拒绝且不产生部分写入', async () => {
  const original = state()
  const { database, pool } = createDatabase(original, { inactiveAdminProductId: 9 })
  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, batch(), 'request-inactive-batch'),
    error => error.statusCode === 409 && error.details.code === 'PRODUCT_INACTIVE'
  )
  assert.deepEqual(database.state, original)
  assert.equal(database.storeUpdates, 0)
  assert.equal(database.adminUpdates.length, 0)
  assert.equal(database.audits.length, 0)
  assert.equal(database.commitCount, 0)
  assert.equal(database.rollbackCount, 1)
})

test('完全相同 batch 重试返回已处理且不重复增加库存', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch()
  const first = await commitPurchaseBatch(pool, membership, request, 'request-first')
  const stockAfterFirst = database.state.products[0].specs[0].stock
  const second = await commitPurchaseBatch(pool, membership, request, 'request-retry')

  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(database.state.products[0].specs[0].stock, stockAfterFirst)
  assert.equal(database.storeUpdates, 1)
  assert.equal(database.audits.length, 2)
})

test('相同 batchTransactionId 但内容不同返回 409', async () => {
  const { database, pool } = createDatabase(state())
  await commitPurchaseBatch(pool, membership, batch(), 'request-original')
  const changed = batch({ items: [
    { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 99, unitCost: 60 },
    { lineId: 'line-2', productId: 'coat', specId: 'coat-m', quantity: 3, unitCost: 30 }
  ] })

  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, changed, 'request-conflict'),
    error => error.statusCode === 409 && error.details.code === 'BATCH_TRANSACTION_CONFLICT'
  )
  assert.equal(database.storeUpdates, 1)
  assert.equal(database.audits.length, 2)
})

test('相同 batchTransactionId 删除或更换行号也返回 409', async () => {
  const { database, pool } = createDatabase(state())
  await commitPurchaseBatch(pool, membership, batch(), 'request-original-lines')
  const changedLines = batch({ items: [
    { lineId: 'replacement-line', productId: 'water', specId: 'water-100', quantity: 2, unitCost: 60 }
  ] })
  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, changedLines, 'request-changed-lines'),
    error => error.statusCode === 409 && error.details.code === 'BATCH_TRANSACTION_CONFLICT'
  )
  assert.equal(database.storeUpdates, 1)
  assert.equal(database.audits.length, 2)
})

test('并发提交相同 batch 最终只执行一次库存写入', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch()
  const results = await Promise.all([
    commitPurchaseBatch(pool, membership, request, 'request-concurrent-1'),
    commitPurchaseBatch(pool, membership, request, 'request-concurrent-2')
  ])

  assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true])
  assert.equal(database.state.products[0].specs[0].stock, 4)
  assert.equal(database.state.products[1].specs[0].stock, 4)
  assert.equal(database.storeUpdates, 1)
  assert.equal(database.audits.length, 2)
})

test('商品不存在时失败并回滚', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch({ items: [
    { lineId: 'line-1', productId: 'not-in-store', specId: 'spec-x', quantity: 1, unitCost: 10 }
  ] })
  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, request, 'request-missing'),
    error => error.statusCode === 404 && /商品不存在/.test(error.message)
  )
  assert.equal(database.rollbackCount, 1)
  assert.equal(database.storeUpdates, 0)
})

test('数量非法在获取数据库连接前失败', async () => {
  const { database, pool } = createDatabase(state())
  const request = batch({ items: [
    { lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 0, unitCost: 10 }
  ] })
  await assert.rejects(
    () => commitPurchaseBatch(pool, membership, request, 'request-invalid'),
    error => error.statusCode === 400 && /数量/.test(error.message)
  )
  assert.equal(database.connectionCount, 0)
})

test('后台商品或审计写入失败时全部事务回滚', async () => {
  const original = state()
  const adminFailure = createDatabase(original, { failAdminProductId: 9 })
  await assert.rejects(
    () => commitPurchaseBatch(adminFailure.pool, membership, batch(), 'request-admin-fail'),
    /后台商品已发生变化/
  )
  assert.deepEqual(adminFailure.database.state, original)
  assert.equal(adminFailure.database.audits.length, 0)

  const auditFailure = createDatabase(original, { failAuditAt: 2 })
  await assert.rejects(
    () => commitPurchaseBatch(auditFailure.pool, membership, batch(), 'request-audit-fail'),
    /audit failed/
  )
  assert.deepEqual(auditFailure.database.state, original)
  assert.equal(auditFailure.database.adminUpdates.length, 0)
  assert.equal(auditFailure.database.audits.length, 0)
})

test('批次和行号生成稳定且请求只采纳交易白名单字段', () => {
  const normalized = normalizeBatchRequest(batch({ items: [{
    lineId: 'line-1', productId: 'water', specId: 'water-100', quantity: 2, unitCost: 60,
    confidence: 1, matchScore: 100, recognized: { productId: 'fake' }
  }] }))
  assert.equal(normalized.items[0].transactionId, derivePurchaseTransactionId('ai-batch-001', 'line-1'))
  assert.equal(Object.hasOwn(normalized.items[0], 'confidence'), false)
  assert.equal(Object.hasOwn(normalized.items[0], 'matchScore'), false)
  assert.equal(Object.hasOwn(normalized.items[0], 'recognized'), false)
  assert.equal(Object.hasOwn(normalized.items[0], 'newProduct'), false)
})

test('HTTP 批量采购接口先校验登录和当前门店权限再提交事务', async () => {
  const { database, pool } = createDatabase(state())
  const membershipQueries = []
  pool.execute = async (sql, args) => {
    membershipQueries.push({ sql, args })
    if (sql.includes('FROM store_members')) return [[{ role: 'owner', store_name: '测试店铺' }]]
    throw new Error(`unexpected pool query: ${sql}`)
  }
  const handler = createRequestHandler(pool, apiConfig())
  const token = signToken({ userId: 'user-1', storeId: 'store-1', role: 'owner' }, JWT_SECRET, 60)
  const result = await invokeBatchApi(handler, batch(), token)

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.duplicate, false)
  assert.equal(result.body.transactions.length, 2)
  assert.deepEqual(membershipQueries[0].args, ['user-1', 'store-1'])
  assert.equal(database.state.purchases.length, 2)
})
