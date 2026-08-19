const assert = require('node:assert/strict')
const test = require('node:test')
const form = require('../utils/transaction-form')
const { createTransactionSubmitter } = require('../utils/transaction-submit')

const singleProduct = {
  id: 'water-100',
  name: '水100ml',
  code: '0001',
  itemNumber: 'W100',
  businessType: 'cosmetics',
  salePrice: 100,
  costPrice: 50,
  specs: [{ id: 'spec-all', color: '全部规格', size: '汇总', stock: 5 }]
}

const multiProduct = {
  id: 'coat',
  name: '白色针织开衫',
  businessType: 'clothing',
  specs: [
    { id: 'white-m', color: '白色', size: 'M', stock: 2 },
    { id: 'white-l', color: '白色', size: 'L', stock: 0 }
  ]
}

test('商品预选按安全 productId 解析', () => {
  const query = form.selectionFromQuery({ productId: 'water-100', specId: 'spec-all', type: 'cosmetics' })
  assert.equal(form.resolveProduct([singleProduct], query.productId), singleProduct)
  assert.equal(query.businessType, 'cosmetics')
})

test('商品名称和货号搜索会去除首尾空格', () => {
  assert.deepEqual(form.productOptions([singleProduct, multiProduct], ' 针织 ').map(item => item.id), ['coat'])
  assert.deepEqual(form.productOptions([singleProduct], ' w100 ').map(item => item.id), ['water-100'])
})

test('单规格自动选中', () => {
  assert.equal(form.resolveSpec(singleProduct, '', 'sale').id, 'spec-all')
})

test('多规格未传 specId 时必须选择', () => {
  assert.equal(form.resolveSpec(multiProduct, '', 'sale'), null)
})

test('具体 specId 可以稳定预选', () => {
  assert.equal(form.resolveSpec(multiProduct, 'white-m', 'sale').id, 'white-m')
})

test('卖货零库存规格不可选择', () => {
  const option = form.specOptions(multiProduct, 'sale').find(item => item.id === 'white-l')
  assert.equal(option.disabled, true)
  assert.equal(option.statusText, '缺货')
})

test('拿货允许选择零库存规格', () => {
  const option = form.specOptions(multiProduct, 'purchase').find(item => item.id === 'white-l')
  assert.equal(option.disabled, false)
})

test('数量为 0、负数和小数均被拒绝', () => {
  assert.match(form.quantityError('0'), /至少为 1/)
  assert.match(form.quantityError('-1'), /至少为 1/)
  assert.match(form.quantityError('1.5'), /整数/)
})

test('非数字与空数量不会产生 NaN', () => {
  assert.match(form.quantityError('abc'), /正确数量/)
  const state = form.transactionState({ mode: 'sale', product: singleProduct, spec: form.resolveSpec(singleProduct), quantity: '', unitAmount: '100' })
  assert.equal(state.totalAmount, 0)
  assert.equal(state.totalAmountText, '¥0.00')
  assert.equal(String(state.afterStock).includes('NaN'), false)
})

test('卖货数量超过真实规格库存时即时拦截', () => {
  const state = form.transactionState({ mode: 'sale', product: singleProduct, spec: form.resolveSpec(singleProduct), quantity: '6', unitAmount: '100' })
  assert.equal(state.canSubmit, false)
  assert.equal(state.errorText, '库存不足，当前仅剩 5 件')
  assert.equal(state.afterStock, 0)
})

test('卖货金额按单价乘数量计算', () => {
  const state = form.transactionState({ mode: 'sale', product: singleProduct, spec: form.resolveSpec(singleProduct), quantity: '2', unitAmount: '129' })
  assert.equal(state.totalAmount, 258)
  assert.equal(state.totalAmountText, '¥258.00')
  assert.equal(state.afterStock, 3)
})

test('拿货成本按进货单价乘数量计算', () => {
  const emptySpec = form.resolveSpec({ ...singleProduct, specs: [{ ...singleProduct.specs[0], stock: 0 }] })
  const state = form.transactionState({ mode: 'purchase', product: singleProduct, spec: emptySpec, quantity: '5', unitAmount: '50' })
  assert.equal(state.canSubmit, true)
  assert.equal(state.totalAmount, 250)
  assert.equal(state.afterStock, 5)
})

test('销售价格允许非负数但拒绝负数', () => {
  assert.equal(form.amountError('0', 'sale'), '')
  assert.match(form.amountError('-0.01', 'sale'), /不能小于 0/)
})

test('进货单价必须大于 0', () => {
  assert.match(form.amountError('0', 'purchase'), /必须大于 0/)
})

test('商品真实价格作为默认值，缺价格保持空白', () => {
  assert.equal(form.defaultUnitAmount(singleProduct, 'sale'), '100')
  assert.equal(form.defaultUnitAmount(singleProduct, 'purchase'), '50')
  assert.equal(form.defaultUnitAmount({}, 'sale'), '')
})

test('成功态展示真实库存前后变化', () => {
  const view = form.successPresentation('sale', { productName: '水100ml', specText: '全部规格 / 汇总', quantity: 2, beforeStock: 5, afterStock: 3, totalAmount: 200, grossProfit: 100 })
  assert.equal(view.stockChangeText, '5 → 3')
  assert.equal(view.amountText, '¥200.00')
  assert.equal(view.profitText, '¥100.00')
})

test('缺少真实成本时成功态不伪造毛利', () => {
  assert.equal(form.successPresentation('sale', { grossProfit: null }).profitText, '')
})

test('缺失商品和规格字段不会渲染 undefined 或 NaN', () => {
  const options = form.productOptions([{ id: 1 }], '')
  const specs = form.specOptions({ specs: [{}] }, 'purchase')
  const output = JSON.stringify({ options, specs, view: form.successPresentation('purchase', {}) })
  assert.equal(/undefined|NaN/.test(output), false)
})

test('损坏的路由编码会被安全保留而不抛错', () => {
  assert.doesNotThrow(() => form.selectionFromQuery({ productId: '%E0%A4%A' }))
})

test('交易路由只编码有效参数', () => {
  assert.equal(
    form.transactionRoute('/pages/sale-form/index', { businessType: 'clothing', productId: '商品 1', specId: '白/M' }),
    '/pages/sale-form/index?type=clothing&productId=%E5%95%86%E5%93%81%201&specId=%E7%99%BD%2FM'
  )
})

test('同一交易编号并发提交只调用一次接口', async () => {
  let calls = 0
  let finish
  const commit = () => {
    calls += 1
    return new Promise(resolve => { finish = resolve })
  }
  const submitter = createTransactionSubmitter({ commitSale: commit, persist() {} })
  const payload = { transactionId: 'sale-once' }
  const first = submitter.submit('sale', payload)
  const second = submitter.submit('sale', payload)
  await Promise.resolve()
  assert.equal(first, second)
  assert.equal(calls, 1)
  finish({ state: {}, transaction: {} })
  await first
})

test('提交失败不会写入前端库存状态', async () => {
  let persisted = false
  const submitter = createTransactionSubmitter({
    commitPurchase: async () => { throw new Error('网络失败') },
    persist() { persisted = true }
  })
  await assert.rejects(submitter.submit('purchase', { transactionId: 'purchase-fail' }), /网络失败/)
  assert.equal(persisted, false)
})

test('后端完整成功响应后才持久化状态', async () => {
  let saved
  const result = { state: { products: [] }, transaction: { afterStock: 3 } }
  const submitter = createTransactionSubmitter({ commitSale: async () => result, persist(state) { saved = state } })
  assert.equal(saved, undefined)
  await submitter.submit('sale', { transactionId: 'sale-ok' })
  assert.deepEqual(saved, result.state)
})
