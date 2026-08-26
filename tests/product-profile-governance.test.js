const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  ProductProfileError,
  normalizeProductProfile,
  productProfileChanges,
  updateProductProfile
} = require('../server/src/product-profile')

function profile(overrides = {}) {
  return {
    name: ' 针织衫 ',
    itemNumber: ' A-136 ',
    category: '上衣',
    salePrice: 99,
    costPrice: 30,
    status: '销售中',
    ...overrides
  }
}

function poolFor(row) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push({ kind: 'begin' }) },
    async commit() { calls.push({ kind: 'commit' }) },
    async rollback() { calls.push({ kind: 'rollback' }) },
    release() { calls.push({ kind: 'release' }) },
    async execute(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'execute', sql: normalized, params })
      if (normalized.startsWith('SELECT id, code')) return [[{ ...row }]]
      return [{ affectedRows: 1 }]
    }
  }
  return { calls, pool: { async getConnection() { return connection } } }
}

test('商品档案字段在 Node 服务端显式校验和规范化', () => {
  assert.deepEqual(normalizeProductProfile(profile()), {
    name: '针织衫', itemNumber: 'A-136', category: '上衣', salePrice: 99, costPrice: 30, status: '销售中'
  })
  assert.equal(normalizeProductProfile(profile({ itemNumber: '   ' })).itemNumber, '')
  assert.equal(normalizeProductProfile(profile({ status: '缺货' })).status, '缺货')
  assert.throws(
    () => normalizeProductProfile(profile({ itemNumber: '货'.repeat(81) })),
    error => error instanceof ProductProfileError && error.statusCode === 400
  )
  assert.throws(() => normalizeProductProfile(profile({ salePrice: -1 })), ProductProfileError)
  assert.throws(() => normalizeProductProfile(profile({ status: '未知' })), ProductProfileError)
})

test('小程序显式清空货号写 NULL、标记 managed、忽略客户端 code 和 id', async () => {
  const { pool, calls } = poolFor({
    id: 8, code: '0008', name: '针织衫', item_number: 'WRONG-8', item_number_managed: 0,
    category: '上衣', price: 99, cost_price: 30, status: '销售中'
  })
  const result = await updateProductProfile(pool, { storeId: 'store-1', userId: 'user-1' }, 8, {
    ...profile({ name: '针织衫', itemNumber: '' }), code: 'tampered', id: 999
  }, 'request-1')
  const update = calls.find(call => call.kind === 'execute' && call.sql.startsWith('UPDATE admin_products'))
  const audit = calls.find(call => call.kind === 'execute' && call.sql.startsWith('INSERT INTO audit_logs'))
  assert.equal(update.params[1], null)
  assert.equal(update.params[2], 1)
  assert.equal(result.code, '0008')
  assert.equal(result.id, 8)
  assert.equal(result.itemNumberManaged, true)
  assert.deepEqual(JSON.parse(audit.params[5]).changes[0], {
    field: 'itemNumber', before: 'WRONG-8', after: '未填写'
  })
})

test('历史 NULL 在未修改货号时保持 unmanaged', async () => {
  const { pool, calls } = poolFor({
    id: 8, code: '0008', name: '针织衫', item_number: null, item_number_managed: 0,
    category: '上衣', price: 99, cost_price: 30, status: '销售中'
  })
  const result = await updateProductProfile(pool, { storeId: 'store-1', userId: 'user-1' }, 8, profile({
    name: '针织衫', itemNumber: ''
  }), 'request-2')
  const update = calls.find(call => call.kind === 'execute' && call.sql.startsWith('UPDATE admin_products'))
  assert.equal(update.params[1], null)
  assert.equal(update.params[2], 0)
  assert.equal(result.itemNumberManaged, false)
})

test('商品档案审计只记录发生变化的治理字段', () => {
  const changes = productProfileChanges(
    { name: '旧名', itemNumber: 'OLD', category: '上衣', salePrice: 80, costPrice: 30, status: '销售中' },
    { name: '新名', itemNumber: 'NEW', category: '外套', salePrice: 99, costPrice: 40, status: '已停用' }
  )
  assert.deepEqual(changes.map(item => item.field), ['name', 'itemNumber', 'category', 'salePrice', 'costPrice', 'status'])
})

test('停用和重新启用使用独立审计动作并保留 requestId', async () => {
  for (const [before, after, action] of [
    ['销售中', '已停用', 'miniapp.product.disable'],
    ['已停用', '销售中', 'miniapp.product.enable']
  ]) {
    const { pool, calls } = poolFor({
      id: 8, code: '0008', name: '针织衫', item_number: null, item_number_managed: 1,
      category: '上衣', price: 99, cost_price: 30, status: before
    })
    await updateProductProfile(pool, { storeId: 'store-1', userId: 'user-1' }, 8, profile({
      name: '针织衫', itemNumber: '', status: after
    }), `request-${action}`)
    const audit = calls.find(call => call.kind === 'execute' && call.sql.startsWith('INSERT INTO audit_logs'))
    assert.equal(audit.params[2], action)
    assert.equal(audit.params[4], `request-${action}`)
    const changes = JSON.parse(audit.params[5]).changes
    assert.deepEqual(changes.find(change => change.field === 'status'), { field: 'status', before, after })
  }
})

test('Web 和小程序商品表单提供真实货号交互且不把 code 当货号', () => {
  const root = path.resolve(__dirname, '..')
  const web = fs.readFileSync(path.join(root, 'admin/src/views/ProductsView.vue'), 'utf8')
  const miniForm = fs.readFileSync(path.join(root, 'pages/product-form/index.wxml'), 'utf8')
  const miniLogic = fs.readFileSync(path.join(root, 'pages/product-form/index.js'), 'utf8')
  const saleForm = fs.readFileSync(path.join(root, 'pages/sale-form/index.wxml'), 'utf8')
  assert.match(web, /货号（选填）/)
  assert.match(web, /maxlength="80"/)
  assert.match(web, /未填写货号/)
  assert.match(web, /内部流水号/)
  assert.match(web, /statusFilter=ref\('active'\)/)
  assert.match(web, /重新启用/)
  assert.match(web, /canDeleteProducts&&deletionEligibility\[p\.id\]\?\.canDelete/)
  assert.match(web, /该商品尚无经营记录，将永久删除商品档案，此操作不可撤销。/)
  assert.doesNotMatch(web, /强制删除/)
  assert.match(miniForm, /maxlength="80"/)
  assert.match(miniLogic, /serverSync\.updateProductProfile/)
  assert.doesNotMatch(saleForm, /itemNumber \|\| currentProduct\.code/)
})

test('商品列表、库存与 AI 候选统一货号优先和内部流水号次要展示', () => {
  const root = path.resolve(__dirname, '..')
  const webProducts = fs.readFileSync(path.join(root, 'admin/src/views/ProductsView.vue'), 'utf8')
  const webInventory = fs.readFileSync(path.join(root, 'admin/src/views/InventoryView.vue'), 'utf8')
  const miniStock = fs.readFileSync(path.join(root, 'pages/stock-overview/index.wxml'), 'utf8')
  const normalAi = fs.readFileSync(path.join(root, 'pages/ai-recognition/index.wxml'), 'utf8')
  const purchaseAi = fs.readFileSync(path.join(root, 'pages/ai-purchase-draft/index.wxml'), 'utf8')
  assert.match(webProducts, /\['商品名称','货号','内部流水号'/)
  assert.match(webInventory, /item\.itemNumber\|\|'未填写货号'/)
  assert.match(webInventory, /内部流水号 \{\{item\.code\}\}/)
  assert.match(miniStock, /item\.itemNumber \? '货号 '/)
  assert.match(normalAi, /item\.itemNumberText/)
  assert.match(normalAi, /item\.internalCodeText/)
  assert.match(purchaseAi, /candidate\.itemNumber \? '货号 '/)
  assert.match(purchaseAi, /内部流水号 \{\{candidate\.code\}\}/)
})
