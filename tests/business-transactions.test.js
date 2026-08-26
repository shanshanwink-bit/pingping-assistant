const assert = require('node:assert/strict')
const test = require('node:test')
const { applyPurchase, applySale } = require('../server/src/business-transactions')
const { commitStoreTransaction } = require('../server/src/app')

function state(stock = 5) {
  return {
    products: [{
      id: 'water', adminProductId: 8, name: '水100ml', businessType: 'cosmetics',
      salePrice: 100, costPrice: 50,
      specs: [{ id: 'all', color: '全部规格', size: '汇总', stock }]
    }],
    operations: [], purchases: [], sales: [], manualProfits: [],
    currentUser: { id: 'u1', name: '萍萍' }
  }
}

test('卖货原子业务函数扣库存并生成销售与操作记录', () => {
  const result = applySale(state(), { transactionId: 'sale-1', productId: 'water', specId: 'all', quantity: 2, unitPrice: 100 }, new Date('2026-08-19T02:00:00Z'))
  assert.equal(result.beforeStock, 5)
  assert.equal(result.afterStock, 3)
  assert.equal(result.state.products[0].specs[0].stock, 3)
  assert.equal(result.state.sales[0].totalAmount, 200)
  assert.equal(result.state.sales[0].grossProfit, 100)
  assert.equal(result.state.operations[0].type, 'outbound')
  assert.equal(result.state.operations[0].referenceId, 'sale-1')
})

test('卖货零库存和超库存均拒绝且不生成记录', () => {
  const empty = state(0)
  assert.throws(() => applySale(empty, { transactionId: 'empty', productId: 'water', specId: 'all', quantity: 1, unitPrice: 100 }), /已缺货/)
  assert.equal(empty.sales.length, 0)
  const insufficient = state(2)
  assert.throws(() => applySale(insufficient, { transactionId: 'over', productId: 'water', specId: 'all', quantity: 3, unitPrice: 100 }), /仅剩 2 件/)
  assert.equal(insufficient.products[0].specs[0].stock, 2)
})

test('服务器再次校验卖货数量必须为正整数', () => {
  for (const quantity of [0, -1, 1.5, NaN]) {
    assert.throws(() => applySale(state(), { transactionId: `bad-${quantity}`, productId: 'water', specId: 'all', quantity, unitPrice: 100 }), /整数/)
  }
})

test('拿货允许零库存并生成采购与入库记录', () => {
  const result = applyPurchase(state(0), { transactionId: 'purchase-1', productId: 'water', specId: 'all', quantity: 5, unitCost: 60 }, new Date('2026-08-19T02:00:00Z'))
  assert.equal(result.beforeStock, 0)
  assert.equal(result.afterStock, 5)
  assert.equal(result.state.purchases[0].totalCost, 300)
  assert.equal(result.state.operations[0].type, 'inbound')
})

test('拿货沿用现有加权平均成本规则', () => {
  const result = applyPurchase(state(5), { transactionId: 'purchase-cost', productId: 'water', specId: 'all', quantity: 5, unitCost: 70 })
  assert.equal(result.state.products[0].costPrice, 60)
  assert.equal(result.state.products[0].specs[0].stock, 10)
})

test('服务器再次校验拿货数量和成本', () => {
  assert.throws(() => applyPurchase(state(), { transactionId: 'bad-q', productId: 'water', specId: 'all', quantity: 1.5, unitCost: 50 }), /整数/)
  assert.throws(() => applyPurchase(state(), { transactionId: 'bad-cost', productId: 'water', specId: 'all', quantity: 1, unitCost: 0 }), /大于 0/)
})

test('相同交易编号重试不会重复扣库存或生成记录', () => {
  const current = state()
  applySale(current, { transactionId: 'same-sale', productId: 'water', specId: 'all', quantity: 1, unitPrice: 100 })
  const retry = applySale(current, { transactionId: 'same-sale', productId: 'water', specId: 'all', quantity: 1, unitPrice: 100 })
  assert.equal(retry.duplicate, true)
  assert.equal(current.products[0].specs[0].stock, 4)
  assert.equal(current.sales.length, 1)
  assert.equal(current.operations.length, 1)
})

function fakePool(sourceState, options = {}) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async execute(sql) {
      calls.push(sql.replace(/\s+/g, ' ').trim())
      if (sql.includes('SELECT state, revision')) return [[{ state: JSON.stringify(sourceState), revision: 4 }]]
      if (sql.includes('SELECT status FROM admin_products')) {
        return [[{ status: options.inactiveProduct ? '已停用' : '销售中' }]]
      }
      if (sql.includes('UPDATE admin_products')) return [{ affectedRows: options.missingProduct ? 0 : 1 }]
      return [{ affectedRows: 1 }]
    }
  }
  return { calls, async getConnection() { return connection } }
}

test('数据库提交把状态、后台汇总库存和审计日志放在同一事务', async () => {
  const pool = fakePool(state())
  const result = await commitStoreTransaction(pool, { storeId: 'store-1', userId: 'user-1' }, 'sale', {
    transactionId: 'tx-atomic', productId: 'water', specId: 'all', quantity: 2, unitPrice: 100
  }, 'request-1')
  assert.equal(result.revision, 5)
  assert.equal(result.transaction.afterStock, 3)
  assert.equal(pool.calls[0], 'begin')
  assert.ok(pool.calls.some(call => call.startsWith('UPDATE store_states')))
  assert.ok(pool.calls.some(call => call.startsWith('UPDATE admin_products')))
  assert.ok(pool.calls.some(call => call.startsWith('INSERT INTO audit_logs')))
  assert.ok(pool.calls.includes('commit'))
  assert.equal(pool.calls.includes('rollback'), false)
})

test('后台汇总商品更新失败时整个数据库事务回滚', async () => {
  const pool = fakePool(state(), { missingProduct: true })
  await assert.rejects(commitStoreTransaction(pool, { storeId: 'store-1', userId: 'user-1' }, 'purchase', {
    transactionId: 'tx-rollback', productId: 'water', specId: 'all', quantity: 2, unitCost: 50
  }, 'request-2'), /后台商品已发生变化/)
  assert.ok(pool.calls.includes('rollback'))
  assert.equal(pool.calls.includes('commit'), false)
})

test('卖货和拿货均拒绝停用商品且不生成经营记录', () => {
  const inactive = state()
  inactive.products[0].status = '已停用'
  for (const [handler, payload] of [
    [applySale, { transactionId: 'inactive-sale', productId: 'water', specId: 'all', quantity: 1, unitPrice: 100 }],
    [applyPurchase, { transactionId: 'inactive-purchase', productId: 'water', specId: 'all', quantity: 1, unitCost: 50 }]
  ]) {
    assert.throws(() => handler(inactive, payload), error => (
      error.statusCode === 409 && error.details.code === 'PRODUCT_INACTIVE'
    ))
  }
  assert.equal(inactive.sales.length, 0)
  assert.equal(inactive.purchases.length, 0)
  assert.equal(inactive.operations.length, 0)
  assert.equal(inactive.products[0].specs[0].stock, 5)
})

test('数据库当前状态已停用时交易整体回滚且不写状态', async () => {
  const pool = fakePool(state(), { inactiveProduct: true })
  await assert.rejects(
    commitStoreTransaction(pool, { storeId: 'store-1', userId: 'user-1' }, 'sale', {
      transactionId: 'inactive-db', productId: 'water', specId: 'all', quantity: 1, unitPrice: 100
    }, 'request-inactive'),
    error => error.statusCode === 409 && error.details.code === 'PRODUCT_INACTIVE'
  )
  assert.equal(pool.calls.some(call => call.startsWith('UPDATE store_states')), false)
  assert.equal(pool.calls.some(call => call.startsWith('INSERT INTO audit_logs')), false)
  assert.ok(pool.calls.includes('rollback'))
})
