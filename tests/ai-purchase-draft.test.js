const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const draftState = require('../utils/ai-purchase-draft')
const {
  createAiPurchaseDraftPage,
  submitErrorView
} = require('../pages/ai-purchase-draft/index')
const serverConfig = require('../utils/server-config')
const serverSync = require('../utils/server-sync')

function pageInstance(definition, data) {
  return {
    ...definition,
    data: { ...definition.data, ...(data || {}) },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (typeof callback === 'function') callback.call(this)
    }
  }
}

function wxStub(overrides) {
  return {
    setNavigationBarTitle() {},
    showModal() {},
    showToast() {},
    switchTab() {},
    navigateTo() {},
    ...overrides
  }
}

function committedResult(overrides) {
  return {
    ok: true,
    duplicate: false,
    revision: 8,
    state: { products: [], operations: [], purchases: [], sales: [] },
    transactions: [{ id: 'purchase-batch-1-line-1' }],
    totalCost: 120,
    ...overrides
  }
}

function draft(overrides) {
  const item = {
    lineId: 'line-1',
    recognized: {
      productName: '清润爽肤水', productCode: 'HZ001', spec: '100ml',
      quantity: 2, unitCost: 60, lineTotal: 120, confidence: 0.9
    },
    matchStatus: 'ready',
    productId: 'water',
    specId: 'spec-100',
    quantity: 2,
    unitCost: 60,
    candidates: [{
      productId: 'water', name: '清润爽肤水', itemNumber: 'TONER100', code: 'HZ001', productCode: 'TONER100',
      specs: [{ specId: 'spec-100', label: '通用 / 100ml', stock: 3 }]
    }],
    issues: [],
    ...overrides
  }
  return { draftId: 'draft-1', items: [item] }
}

test('草稿正常展示识别内容、匹配状态和金额', () => {
  const view = draftState.presentDraft(draft())
  assert.equal(view.items.length, 1)
  assert.equal(view.items[0].recognizedText, '清润爽肤水 · HZ001 · 100ml')
  assert.equal(view.items[0].status.label, '已匹配')
  assert.equal(view.items[0].status.tone, 'ready')
  assert.equal(view.items[0].lineTotalText, '¥120.00')
  assert.equal(view.canConfirm, true)
})

test('修改数量只更新当前草稿并重新计算金额', () => {
  const updated = draftState.updateQuantity(draft(), 'line-1', '5')
  const view = draftState.presentDraft(updated)
  assert.equal(view.items[0].quantity, 5)
  assert.equal(view.items[0].lineTotalText, '¥300.00')
  assert.equal(view.items[0].recognized.quantity, 2, 'AI 原始识别值应保留')
})

test('修改进价只更新当前草稿并重新计算金额', () => {
  const updated = draftState.updateUnitCost(draft(), 'line-1', '66.5')
  const view = draftState.presentDraft(updated)
  assert.equal(view.items[0].unitCost, 66.5)
  assert.equal(view.items[0].lineTotalText, '¥133.00')
  assert.equal(view.items[0].recognized.unitCost, 60, 'AI 原始识别值应保留')
})

test('删除错误行只改变草稿数组', () => {
  const original = draft()
  const updated = draftState.removeItem(original, 'line-1')
  assert.equal(updated.items.length, 0)
  assert.equal(original.items.length, 1)
})

test('未完成行禁止确认', () => {
  const missingValue = draftState.updateQuantity(draft(), 'line-1', '')
  assert.equal(draftState.canConfirm(missingValue), false)
  assert.equal(draftState.presentDraft(missingValue).items[0].matchStatus, 'needs_values')

  const missingSpec = draft({ specId: '', candidates: [{
    productId: 'water', name: '清润爽肤水', specs: [
      { specId: 'spec-100', label: '100ml', stock: 3 },
      { specId: 'spec-200', label: '200ml', stock: 2 }
    ]
  }] })
  assert.equal(draftState.canConfirm(missingSpec), false)
  assert.equal(draftState.presentDraft(missingSpec).items[0].matchStatus, 'needs_spec')
})

test('inactive_match 在小程序保持不可确认且不能生成入库请求', () => {
  const source = draft({
    matchStatus: 'inactive_match',
    productId: '',
    specId: '',
    candidates: [],
    inactiveMatch: { name: '清润爽肤水', productCode: 'TONER100' }
  })
  const normalized = draftState.normalizeDraft(source)
  assert.equal(normalized.items[0].matchStatus, 'inactive_match')
  assert.equal(Object.hasOwn(normalized.items[0], 'createNew'), false)
  assert.equal(draftState.canConfirm(normalized), false)
  assert.throws(() => draftState.batchPayload(normalized), /未完成项目/)
})

test('选择商品后单规格可预选，多规格仍要求人工选择', () => {
  const source = draft({ productId: '', specId: '', candidates: [{
    productId: 'water', name: '清润爽肤水', specs: [
      { specId: 'spec-100', label: '100ml', stock: 3 },
      { specId: 'spec-200', label: '200ml', stock: 2 }
    ]
  }] })
  const selectedProduct = draftState.selectProduct(source, 'line-1', 'water')
  assert.equal(selectedProduct.items[0].matchStatus, 'needs_spec')
  assert.equal(selectedProduct.items[0].specId, '')
  const selectedSpec = draftState.selectSpec(selectedProduct, 'line-1', 'spec-200')
  assert.equal(selectedSpec.items[0].matchStatus, 'ready')
})

test('确认草稿生成批量接口要求的最小可信字段', () => {
  assert.deepEqual(draftState.batchPayload(draft()), {
    batchTransactionId: 'draft-1',
    supplier: '',
    note: '',
    items: [{
      lineId: 'line-1',
      productId: 'water',
      specId: 'spec-100',
      quantity: 2,
      unitCost: 60
    }]
  })
})

test('未匹配商品保持安全状态且不能确认入库', () => {
  const unmatched = draft({ productId: '', specId: '', candidates: [] })
  const view = draftState.presentDraft(unmatched)
  assert.equal(view.canConfirm, false)
  assert.equal(view.items[0].matchStatus, 'needs_product')
  assert.equal(view.items[0].status.label, '未找到商品')
  assert.equal(Object.hasOwn(view.items[0], 'createNew'), false)
  assert.throws(() => draftState.batchPayload(view.draft), /未完成项目/)
})

test('确认入库成功调用批量接口并用服务端状态刷新本地库存', async () => {
  const calls = []
  const persisted = []
  const result = committedResult()
  const page = pageInstance(createAiPurchaseDraftPage({
    wxApi: wxStub(),
    confirmSubmission: async () => true,
    serverSync: { async commitPurchaseBatch(payload) { calls.push(payload); return result } },
    persistState(state) { persisted.push(state) }
  }))
  page.receiveDraft(draft())

  await page.confirmDraft()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].batchTransactionId, 'draft-1')
  assert.deepEqual(persisted, [result.state])
  assert.equal(page.data.success, true)
  assert.equal(page.data.successTitle, '入库成功')
})

test('重复批次返回已处理且不会在客户端再次叠加库存', async () => {
  let callCount = 0
  let persistCount = 0
  const page = pageInstance(createAiPurchaseDraftPage({
    wxApi: wxStub(),
    confirmSubmission: async () => true,
    serverSync: {
      async commitPurchaseBatch() {
        callCount += 1
        return committedResult({ duplicate: true })
      }
    },
    persistState() { persistCount += 1 }
  }))
  page.receiveDraft(draft())

  await page.confirmDraft()

  assert.equal(callCount, 1)
  assert.equal(persistCount, 1, '只应用服务端返回的最终状态，不在本地累加库存')
  assert.equal(page.data.successTitle, '该批次已处理')
  assert.match(page.data.successMessage, /没有重复增加/)
})

test('接口失败不刷新本地库存并明确事务未完成', async () => {
  let persistCount = 0
  const error = new Error('商品不存在')
  error.statusCode = 404
  const page = pageInstance(createAiPurchaseDraftPage({
    wxApi: wxStub(),
    confirmSubmission: async () => true,
    serverSync: { async commitPurchaseBatch() { throw error } },
    persistState() { persistCount += 1 }
  }))
  page.receiveDraft(draft())

  await page.confirmDraft()

  assert.equal(persistCount, 0)
  assert.equal(page.data.success, false)
  assert.equal(page.data.submitErrorTitle, '商品数据已变化')
  assert.match(page.data.submitErrorText, /库存未发生变化/)
})

test('网络失败不刷新本地库存并提示使用同一批次重试', async () => {
  let persistCount = 0
  const page = pageInstance(createAiPurchaseDraftPage({
    wxApi: wxStub(),
    confirmSubmission: async () => true,
    serverSync: { async commitPurchaseBatch() { throw new Error('request:fail timeout') } },
    persistState() { persistCount += 1 }
  }))
  page.receiveDraft(draft())

  await page.confirmDraft()

  assert.equal(persistCount, 0)
  assert.equal(page.data.submitErrorTitle, '网络连接失败')
  assert.match(page.data.submitErrorText, /本地库存未更新/)
  assert.match(page.data.submitErrorText, /同一批次重试/)
})

test('取消二次确认不会调用批量接口', async () => {
  let callCount = 0
  let persistCount = 0
  const page = pageInstance(createAiPurchaseDraftPage({
    wxApi: wxStub(),
    confirmSubmission: async () => false,
    serverSync: { async commitPurchaseBatch() { callCount += 1 } },
    persistState() { persistCount += 1 }
  }))
  page.receiveDraft(draft())

  await page.confirmDraft()

  assert.equal(callCount, 0)
  assert.equal(persistCount, 0)
})

test('批次冲突和事务失败使用不同错误提示', () => {
  assert.equal(submitErrorView({
    statusCode: 409,
    message: '批次冲突',
    details: { code: 'BATCH_TRANSACTION_CONFLICT' }
  }).title, '批次内容冲突')
  assert.equal(submitErrorView({ statusCode: 500, message: '事务失败' }).title, '入库事务失败')
})

test('server-sync 使用登录令牌调用批量采购接口', async () => {
  const originalWx = global.wx
  let requestOptions
  global.wx = {
    getStorageSync(key) {
      if (key === serverConfig.sessionKey) return { token: 'miniapp-token' }
      return ''
    },
    request(options) {
      requestOptions = options
      options.success({ statusCode: 200, data: committedResult() })
    }
  }
  const payload = draftState.batchPayload(draft())
  try {
    await serverSync.commitPurchaseBatch(payload)
    assert.equal(requestOptions.url, `${serverConfig.apiBaseUrl}/store/purchases/batch`)
    assert.equal(requestOptions.method, 'POST')
    assert.equal(requestOptions.header.Authorization, 'Bearer miniapp-token')
    assert.deepEqual(requestOptions.data, payload)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('草稿页面只通过批量采购提交，不调用单笔拿货或卖货逻辑', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'ai-purchase-draft', 'index.js'), 'utf8')
  const template = fs.readFileSync(path.join(__dirname, '..', 'pages', 'ai-purchase-draft', 'index.wxml'), 'utf8')
  assert.match(source, /commitPurchaseBatch/)
  assert.doesNotMatch(source, /commitPurchase\s*\(|commitSale\s*\(|updateStock|addPurchase/)
  assert.match(template, /'确认入库'/)
  assert.match(template, /candidate\.itemNumber \? '货号 '/)
  assert.match(template, /内部流水号 \{\{candidate\.code\}\}/)
  assert.doesNotMatch(template, /candidate\.code\s*\|\|\s*candidate\.itemNumber/)
  assert.match(template, /本阶段不会自动创建商品/)
  assert.match(template, /找到已停用商品，请先重新启用或选择其他商品。/)
  assert.match(template, /停用商品不会直接参与入库。/)
  assert.doesNotMatch(template, /作为新商品|建档并入库|createNew/)
  assert.doesNotMatch(template, /确认草稿（暂不入库）/)
})
