const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createPurchaseDraft,
  createPurchaseDraftFromProducts,
  loadPurchasableProducts
} = require('../server/src/purchase-draft')

function product(overrides) {
  return {
    id: 'water-100',
    adminProductId: 1,
    code: 'HZ001',
    itemNumber: 'TONER100',
    name: '清润爽肤水',
    businessType: 'cosmetics',
    category: '护肤',
    brand: '清润',
    specs: [{ id: 'spec-100', color: '通用', size: '100ml', stock: 3 }],
    ...overrides
  }
}

function recognized(overrides) {
  return {
    items: [{
      lineId: 'line-1',
      productName: '清润爽肤水',
      productCode: '',
      spec: '100ml',
      quantity: 5,
      unitCost: 60,
      lineTotal: 300,
      confidence: 0.9,
      issues: [],
      ...overrides
    }]
  }
}

function draft(input, products) {
  return createPurchaseDraftFromProducts(input, products, 'draft-test')
}

test('货号唯一匹配并使用真实商品和单规格 ID', () => {
  const result = draft(recognized({
    productName: '',
    productCode: 'HZ001',
    spec: ''
  }), [product()])
  assert.equal(result.items[0].matchStatus, 'ready')
  assert.equal(result.items[0].productId, 'water-100')
  assert.equal(result.items[0].specId, 'spec-100')
  assert.equal(result.items[0].requiresManual, false)
})

test('商品编号可以与真实 itemNumber 完全匹配', () => {
  const result = draft(recognized({
    productName: '',
    productCode: 'TONER100',
    spec: ''
  }), [product({ code: 'SYS0001', itemNumber: 'TONER100' })])
  assert.equal(result.items[0].matchStatus, 'ready')
  assert.equal(result.items[0].productId, 'water-100')
  assert.deepEqual(result.items[0].candidates[0].matchReasons, ['商品编号一致'])
})

test('标准化后的商品名称可以唯一匹配', () => {
  const result = draft(recognized({ productName: '清润 爽肤水' }), [product()])
  assert.equal(result.items[0].matchStatus, 'ready')
  assert.equal(result.items[0].productId, 'water-100')
})

test('同名不同规格商品在规格不足时返回商品候选', () => {
  const products = [
    product({ id: 'water-100', code: 'HZ100', specs: [{ id: 's100', color: '通用', size: '100ml', stock: 3 }] }),
    product({ id: 'water-200', code: 'HZ200', specs: [{ id: 's200', color: '通用', size: '200ml', stock: 2 }] })
  ]
  const result = draft(recognized({ productName: '清润爽肤水', productCode: '', spec: '' }), products)
  assert.equal(result.items[0].matchStatus, 'needs_product')
  assert.equal(result.items[0].productId, '')
  assert.equal(result.items[0].specId, '')
  assert.equal(result.items[0].candidates.length, 2)
})

test('无匹配时不会创建商品或规格', () => {
  const products = [product()]
  const snapshot = JSON.parse(JSON.stringify(products))
  const result = draft(recognized({
    productName: '完全不存在的连衣裙',
    productCode: '',
    spec: '黑色 L'
  }), products)
  assert.equal(result.items[0].matchStatus, 'needs_product')
  assert.equal(result.items[0].candidates.length, 0)
  assert.equal(result.items[0].productId, '')
  assert.equal(result.items[0].specId, '')
  assert.deepEqual(products, snapshot)
})

test('低置信度即使货号一致也要求人工选择商品', () => {
  const result = draft(recognized({
    productName: '',
    productCode: 'HZ001',
    confidence: 0.4
  }), [product()])
  assert.equal(result.items[0].matchStatus, 'needs_product')
  assert.equal(result.items[0].productId, '')
  assert.equal(result.items[0].candidates.length, 1)
  assert.equal(result.items[0].requiresManual, true)
})

test('多规格商品只在规格文字唯一精确匹配时预选', () => {
  const multiSpec = product({
    specs: [
      { id: 'spec-100', color: '通用', size: '100ml', stock: 3 },
      { id: 'spec-200', color: '通用', size: '200ml', stock: 2 }
    ]
  })
  const exact = draft(recognized({ spec: '200ml' }), [multiSpec])
  assert.equal(exact.items[0].matchStatus, 'ready')
  assert.equal(exact.items[0].specId, 'spec-200')

  const missing = draft(recognized({ spec: '' }), [multiSpec])
  assert.equal(missing.items[0].matchStatus, 'needs_spec')
  assert.equal(missing.items[0].specId, '')
  assert.equal(missing.items[0].specCandidates.length, 2)
})

test('商品和规格明确但数量或进价缺失时标记 needs_values', () => {
  const result = draft(recognized({ quantity: null, unitCost: null }), [product()])
  assert.equal(result.items[0].matchStatus, 'needs_values')
  assert.equal(result.items[0].requiresManual, true)
  assert.ok(result.items[0].issues.includes('数量无法确认'))
  assert.ok(result.items[0].issues.includes('单价无法确认'))
})

test('门店商品加载严格按 storeId 只读查询', async () => {
  const calls = []
  const pool = {
    async execute(sql, args) {
      calls.push({ sql, args })
      assert.match(sql, /^SELECT\s/i)
      return [[{ state: JSON.stringify({ products: [product()] }) }]]
    }
  }
  const products = await loadPurchasableProducts(pool, 'store-a')
  assert.equal(products[0].id, 'water-100')
  assert.deepEqual(calls[0].args, ['store-a'])
})

test('草稿 ID 由服务端生成器提供且生成过程不写数据库', async () => {
  const calls = []
  const pool = {
    async execute(sql) {
      calls.push(sql)
      return [[{ state: JSON.stringify({ products: [product()] }) }]]
    }
  }
  const result = await createPurchaseDraft(pool, 'store-a', recognized(), {
    draftIdFactory: () => 'server-draft-id'
  })
  assert.equal(result.draftId, 'server-draft-id')
  assert.equal(result.items[0].matchStatus, 'ready')
  assert.equal(calls.length, 1)
  assert.ok(calls.every(sql => /^SELECT\s/i.test(sql)))
})
