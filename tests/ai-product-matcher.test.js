const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createAiRecognitionService } = require('../server/src/ai-recognition')
const { loadBusinessProducts, matchProducts, scoreProduct } = require('../server/src/product-matcher')

function vision(overrides) {
  return {
    category: 'cosmetics',
    productName: '爽肤水',
    productCode: '',
    brand: '',
    spec: '100ml',
    visibleText: ['100ml'],
    keywords: ['爽肤水'],
    confidence: 0.9,
    ...overrides
  }
}

function product(overrides) {
  return {
    id: 'p-1', adminProductId: 1, code: 'HZ001', name: '爽肤水',
    businessType: 'cosmetics', category: '护肤', brand: '', itemNumber: '',
    specs: ['通用 / 100ml'], salePrice: 100, stock: 3,
    recentPurchase: null, firstPurchase: null, purchaseHistoryReliable: false,
    ...overrides
  }
}

function businessPool(adminRows, state, calls) {
  return {
    async execute(sql, args) {
      if (calls) calls.push({ sql, args })
      if (sql.includes('FROM admin_products')) return [adminRows]
      if (sql.includes('FROM store_states')) return [state ? [{ state }] : []]
      throw new Error(`unexpected query: ${sql}`)
    }
  }
}

function sampleState(purchases, overrides) {
  return {
    products: [{
      id: 'local-1', adminProductId: 1, code: 'HZ001', name: '爽肤水100ml',
      businessType: 'cosmetics', category: '护肤', brand: '清润', itemNumber: 'TONER100',
      salePrice: 90, specs: [{ id: 's1', color: '通用', size: '100ml', stock: 2 }],
      ...overrides
    }],
    purchases: purchases || []
  }
}

const adminRows = [{
  id: 1, name: '爽肤水100ml', code: 'HZ001', business_type: '化妆品', category: '护肤',
  spec_count: 1, stock: 3, price: '100.00'
}]

test('AI 商品读取使用后台新货号并识别显式清空语义', async () => {
  const updated = await loadBusinessProducts(businessPool([{
    ...adminRows[0], item_number: 'NEW-100', item_number_managed: 1
  }], sampleState()))
  assert.equal(updated[0].itemNumber, 'NEW-100')

  const cleared = await loadBusinessProducts(businessPool([{
    ...adminRows[0], item_number: null, item_number_managed: 1
  }], sampleState()))
  assert.equal(cleared[0].itemNumber, '')

  const legacy = await loadBusinessProducts(businessPool([{
    ...adminRows[0], item_number: null, item_number_managed: 0
  }], sampleState()))
  assert.equal(legacy[0].itemNumber, 'TONER100')
})

test('唯一高置信商品匹配', () => {
  const result = matchProducts(vision(), [product()])
  assert.equal(result.matchType, 'unique')
  assert.equal(result.items[0].name, '爽肤水')
})

test('真实货号原值精确匹配优先于名称组合和旧 code', () => {
  const result = matchProducts(vision({
    productName: '旧流水号商品', productCode: 'TAG-100', spec: '', visibleText: [], keywords: []
  }), [
    product({ id: 'real-item', name: '另一商品', itemNumber: 'TAG-100', code: 'SYS0009' }),
    product({ id: 'legacy-code', name: '旧流水号商品', itemNumber: '', code: 'TAG-100' })
  ])
  assert.equal(result.matchType, 'unique')
  assert.equal(result.items[0].id, 'real-item')
  assert.deepEqual(result.items[0].matchReasons, ['真实货号原值一致'])
})

test('真实货号标准化精确匹配支持格式差异', () => {
  const result = matchProducts(vision({
    productName: '', productCode: 'tag 100', spec: '', visibleText: [], keywords: []
  }), [product({ itemNumber: 'TAG-100', code: 'SYS0001' })])
  assert.equal(result.matchType, 'unique')
  assert.deepEqual(result.items[0].matchReasons, ['真实货号标准化一致'])
})

test('重复真实货号即使格式不同也只返回候选，不自动绑定', () => {
  const result = matchProducts(vision({
    productName: '', productCode: 'TAG-100', spec: '', visibleText: [], keywords: []
  }), [
    product({ id: 'p-raw', itemNumber: 'TAG-100' }),
    product({ id: 'p-normalized', itemNumber: 'TAG 100' })
  ])
  assert.equal(result.matchType, 'candidates')
  assert.deepEqual(result.items.map(item => item.id), ['p-raw', 'p-normalized'])
})

test('旧 code 只在没有更强业务信号时作为兼容回退', () => {
  const result = matchProducts(vision({
    productName: '', productCode: 'HZ001', spec: '', visibleText: [], keywords: []
  }), [product({ itemNumber: '', code: 'HZ001' })])
  assert.equal(result.matchType, 'unique')
  assert.deepEqual(result.items[0].matchReasons, ['内部流水号兼容一致'])
})

test('OCR 数字与旧 code 相似不会直接形成 code 候选', () => {
  const result = matchProducts(vision({
    productName: '', productCode: '', spec: '', visibleText: ['HZ001'], keywords: []
  }), [product({ name: '完全无关商品', itemNumber: '', code: 'HZ001' })])
  assert.deepEqual(result, { matchType: 'none', items: [] })
})

test('多个合理候选最多返回 3 个并交给用户选择', () => {
  const products = [
    product({ id: 'p1', name: '清润爽肤水100ml', specs: ['100ml'] }),
    product({ id: 'p2', name: '清润爽肤水200ml', specs: ['200ml'] }),
    product({ id: 'p3', name: '水润爽肤水补充装', specs: ['补充装'] }),
    product({ id: 'p4', name: '爽肤水旅行装', specs: ['30ml'] })
  ]
  const result = matchProducts(vision({ spec: '', visibleText: [] }), products)
  assert.equal(result.matchType, 'candidates')
  assert.equal(result.items.length, 3)
  assert.ok(result.items.every(item => Number.isFinite(item.matchScore)))
  assert.ok(result.items[0].matchScore >= result.items[1].matchScore)
  assert.ok(result.items[1].matchScore >= result.items[2].matchScore)
})

test('常见单字水与商品类型一致不足以形成候选', () => {
  const result = matchProducts(vision({
    productName: '水', spec: '', visibleText: [], keywords: ['水']
  }), [product({ name: '水润修护精华液', specs: ['通用 / 100ml'] })])
  assert.deepEqual(result, { matchType: 'none', items: [] })
})

test('单独规格 100ml 与商品类型一致不足以形成候选', () => {
  const result = matchProducts(vision({
    productName: '', spec: '100ml', visibleText: ['100ml'], keywords: []
  }), [product({ name: '水润修护精华液', specs: ['通用 / 100ml'] })])
  assert.deepEqual(result, { matchType: 'none', items: [] })
})

test('OCR 经营文字不参与商品身份匹配', () => {
  const result = matchProducts(vision({
    productName: '', spec: '', visibleText: ['缺货', '进价', '¥100.00', '2026-08-12'], keywords: []
  }), [product({ name: '水润修护精华液', specs: ['通用 / 100ml'] })])
  assert.deepEqual(result, { matchType: 'none', items: [] })
})

test('低 confidence 即使名称完全一致也不强行唯一匹配', () => {
  const result = matchProducts(vision({ confidence: 0.4 }), [product()])
  assert.equal(result.matchType, 'candidates')
  assert.equal(result.items.length, 1)
})

test('没有合理候选时不会自动新建商品', () => {
  const result = matchProducts(vision(), [product({ name: '黑色牛仔裤', businessType: 'clothing', specs: ['黑色 / M'] })])
  assert.deepEqual(result, { matchType: 'none', items: [] })
})

test('候选评分会同时使用包装规格和商品类型', () => {
  const scored = scoreProduct(
    vision({ productName: '未知', visibleText: ['水润'], keywords: [] }),
    product({ name: '水润精华100ml' })
  )
  assert.ok(scored.score >= 28)
  assert.ok(scored.reasons.includes('包装文字或规格匹配'))
  assert.ok(scored.reasons.includes('商品类型一致'))
})

test('真实售价从 admin_products 读取而不是 AI 输出', async () => {
  const items = await loadBusinessProducts(businessPool(adminRows, sampleState()), 'store-a')
  assert.equal(items[0].salePrice, 100)
})

test('未设置的零售价返回 null，不渲染伪造的 ¥0.00', async () => {
  const rows = [{ ...adminRows[0], price: 0 }]
  const items = await loadBusinessProducts(businessPool(rows, sampleState()), 'store-a')
  assert.equal(items[0].salePrice, null)
})

test('真实当前库存从 admin_products 聚合库存读取', async () => {
  const items = await loadBusinessProducts(businessPool(adminRows, sampleState()), 'store-a')
  assert.equal(items[0].stock, 3)
  assert.deepEqual(items[0].specs, ['通用 / 100ml'])
})

test('最近进货时间和最近进价来自有效 purchases 记录', async () => {
  const purchases = [
    { id: 'pu-old', productId: 'local-1', createdAt: '2026-08-01 10:00', unitCost: 55 },
    { id: 'pu-new', productId: 'local-1', createdAt: '2026-08-12 16:30', unitCost: 60 }
  ]
  const items = await loadBusinessProducts(businessPool(adminRows, sampleState(purchases)), 'store-a')
  assert.equal(items[0].recentPurchase.occurredAt, '2026-08-12 16:30')
  assert.equal(items[0].recentPurchase.unitCost, 60)
  assert.equal(items[0].firstPurchase, null, '未证明历史完整时不得伪造首次进货')
})

test('没有采购记录时返回 null 而不是 undefined 或估算值', async () => {
  const items = await loadBusinessProducts(businessPool(adminRows, sampleState([])), 'store-a')
  assert.equal(items[0].recentPurchase, null)
  assert.equal(items[0].firstPurchase, null)
})

test('只有明确标记历史完整时才返回首次进货', async () => {
  const purchases = [
    { id: 'pu-old', productId: 'local-1', createdAt: '2026-07-01 10:00', unitCost: 50 },
    { id: 'pu-new', productId: 'local-1', createdAt: '2026-08-01 10:00', unitCost: 55 }
  ]
  const state = sampleState(purchases, { purchaseHistoryComplete: true })
  const items = await loadBusinessProducts(businessPool(adminRows, state), 'store-a')
  assert.equal(items[0].firstPurchase.occurredAt, '2026-07-01 10:00')
  assert.equal(items[0].purchaseHistoryReliable, true)
})

test('商品与经营状态查询都严格按同一 storeId 隔离', async () => {
  const calls = []
  await loadBusinessProducts(businessPool(adminRows, sampleState(), calls), 'store-b')
  assert.equal(calls.length, 2)
  calls.forEach(call => assert.deepEqual(call.args, ['store-b']))
})

test('不同店铺不能读取另一店铺商品', async () => {
  const pool = {
    async execute(sql, args) {
      if (args[0] !== 'store-a') return [[]]
      if (sql.includes('FROM admin_products')) return [adminRows]
      return [[{ state: sampleState() }]]
    }
  }
  assert.equal((await loadBusinessProducts(pool, 'store-a')).length, 1)
  assert.equal((await loadBusinessProducts(pool, 'store-b')).length, 0)
})

test('完整识别流程只把模型特征交给本地匹配器', async () => {
  const service = createAiRecognitionService({}, {
    ai: { apiKey: String(true), maxImageBytes: 1024, rateLimitWindowMs: 60000, rateLimitMax: 6 }
  }, {
    readFlag: async () => true,
    readImage: async () => ({ mime: 'image/jpeg', buffer: Buffer.alloc(12) }),
    visionClient: { recognize: async () => vision() },
    loadProducts: async () => [product()]
  })
  const result = await service.recognize({}, { storeId: 'store-a', userId: 'user-a' })
  assert.equal(result.matchType, 'unique')
  assert.equal(result.items[0].salePrice, 100)
  assert.equal(result.items[0].stock, 3)
})

test('真实商品数据查询失败时不会退回 AI 猜测', async () => {
  const pool = { async execute() { throw new Error('db failed') } }
  await assert.rejects(() => loadBusinessProducts(pool, 'store-a'), error => error.statusCode === 500)
})

test('普通 AI 排除停用商品且 state-only 不能重新加入', async () => {
  const inactiveAdmin = [{ ...adminRows[0], status: '已停用' }]
  const adminLinked = await loadBusinessProducts(businessPool(inactiveAdmin, sampleState([], { status: '销售中' })), 'store-a')
  assert.equal(adminLinked.length, 0, '数据库停用状态必须覆盖陈旧 JSON 启用状态')

  const stateOnly = sampleState([], { adminProductId: null, id: 'state-only', status: '已停用' })
  const stateOnlyProducts = await loadBusinessProducts(businessPool([], stateOnly), 'store-a')
  assert.equal(stateOnlyProducts.length, 0)

  assert.deepEqual(matchProducts(vision(), [product({ status: '已停用' })]), { matchType: 'none', items: [] })
})

test('缺失状态和历史缺货继续作为普通 AI 启用候选', () => {
  assert.equal(matchProducts(vision(), [product()]).matchType, 'unique')
  assert.equal(matchProducts(vision(), [product({ status: '缺货' })]).matchType, 'unique')
})
