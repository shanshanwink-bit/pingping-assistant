const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const {
  createAiPurchasePage,
  navigateToDraft
} = require('../pages/ai-purchase/index')
const serverConfig = require('../utils/server-config')
const serverSync = require('../utils/server-sync')

const root = path.resolve(__dirname, '..')

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
    getStorageSync() { return true },
    setStorageSync() {},
    showModal() {},
    setNavigationBarTitle() {},
    navigateBack() {},
    switchTab() {},
    navigateTo() {},
    ...overrides
  }
}

function sampleDraft() {
  return {
    draftId: 'draft-1',
    items: [{
      lineId: 'line-1',
      recognized: { productName: '爽肤水', spec: '100ml', quantity: 2, unitCost: 60 },
      matchStatus: 'ready', productId: 'water', specId: 'water-100', candidates: [], issues: []
    }]
  }
}

test('AI 商品助手显示可点击的拍照入库入口', () => {
  const template = fs.readFileSync(path.join(root, 'pages', 'ai-recognition', 'index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'pages', 'ai-recognition', 'index.js'), 'utf8')
  assert.match(template, /拍照入库/)
  assert.match(template, /识别进货单，快速生成入库草稿/)
  assert.match(template, /bindtap="openAiPurchase"/)
  assert.match(source, /pages\/ai-purchase\/index/)
  assert.match(source, /if \(!this\.data\.featureEnabled\) return/)
})

test('图片选择后显示预览路径和大小', async () => {
  const definition = createAiPurchasePage({
    wxApi: wxStub(),
    serverSync: {},
    confirmPrivacyNotice: async () => true,
    chooseProductImage: async () => ({ path: '/tmp/order.jpg', size: 2048 }),
    imageSizeText: size => `${size / 1024} KB`
  })
  const page = pageInstance(definition, { featureEnabled: true, featureChecking: false })
  await page.chooseImage()
  assert.equal(page.data.selectedImage, '/tmp/order.jpg')
  assert.equal(page.data.selectedImageSize, '2 KB')
  assert.equal(page.data.errorMessage, '')
})

test('删除图片只清除当前页面预览且可以重新选择', async () => {
  let selection = 0
  const definition = createAiPurchasePage({
    wxApi: wxStub(),
    serverSync: {},
    confirmPrivacyNotice: async () => true,
    chooseProductImage: async () => ({ path: `/tmp/order-${++selection}.jpg`, size: 1024 }),
    imageSizeText: () => '1 KB'
  })
  const page = pageInstance(definition, { featureEnabled: true, featureChecking: false })
  await page.chooseImage()
  assert.equal(page.data.selectedImage, '/tmp/order-1.jpg')
  page.removeImage()
  assert.equal(page.data.selectedImage, '')
  await page.chooseImage()
  assert.equal(page.data.selectedImage, '/tmp/order-2.jpg')
})

test('识别按钮调用采购单识别接口并把草稿传给下一页', async () => {
  const calls = []
  let openedDraft
  const draft = sampleDraft()
  const definition = createAiPurchasePage({
    wxApi: wxStub(),
    serverSync: {
      async recognizePurchaseOrderImage(filePath) {
        calls.push(filePath)
        return { ok: true, items: [], warnings: [], draft }
      }
    },
    navigateToDraft: async value => { openedDraft = value }
  })
  const page = pageInstance(definition, {
    featureEnabled: true,
    featureChecking: false,
    selectedImage: '/tmp/order.jpg'
  })
  await page.startRecognition()
  assert.deepEqual(calls, ['/tmp/order.jpg'])
  assert.deepEqual(openedDraft, draft)
  assert.equal(page.data.recognizing, false)
  assert.equal(page.data.errorMessage, '')
})

test('server-sync 使用登录令牌上传到采购单识别接口', async () => {
  const originalWx = global.wx
  let uploadOptions
  global.wx = {
    getStorageSync(key) {
      if (key === serverConfig.sessionKey) return { token: 'miniapp-token' }
      return ''
    },
    uploadFile(options) {
      uploadOptions = options
      options.success({
        statusCode: 200,
        data: JSON.stringify({ ok: true, draft: sampleDraft(), warnings: [] })
      })
    }
  }
  try {
    const result = await serverSync.recognizePurchaseOrderImage('/tmp/order.jpg')
    assert.equal(uploadOptions.url, `${serverConfig.apiBaseUrl}/ai/purchase-order-recognition`)
    assert.equal(uploadOptions.filePath, '/tmp/order.jpg')
    assert.equal(uploadOptions.name, 'image')
    assert.equal(uploadOptions.header.Authorization, 'Bearer miniapp-token')
    assert.equal(result.draft.draftId, 'draft-1')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('成功后进入草稿页并通过 EventChannel 传递内存草稿', async () => {
  let targetUrl = ''
  let eventName = ''
  let eventDraft
  const draft = sampleDraft()
  await navigateToDraft(wxStub({
    navigateTo(options) {
      targetUrl = options.url
      options.success({
        eventChannel: {
          emit(name, value) { eventName = name; eventDraft = value }
        }
      })
    }
  }), draft)
  assert.equal(targetUrl, '/pages/ai-purchase-draft/index')
  assert.equal(eventName, 'purchaseDraft')
  assert.deepEqual(eventDraft, draft)
})

test('识别失败时保留图片并显示服务端错误原因', async () => {
  const definition = createAiPurchasePage({
    wxApi: wxStub(),
    serverSync: {
      async recognizePurchaseOrderImage() { throw new Error('图片文字不清晰，请重新拍摄') }
    }
  })
  const page = pageInstance(definition, {
    featureEnabled: true,
    featureChecking: false,
    selectedImage: '/tmp/order.jpg'
  })
  await page.startRecognition()
  assert.equal(page.data.selectedImage, '/tmp/order.jpg')
  assert.equal(page.data.errorMessage, '图片文字不清晰，请重新拍摄')
  assert.equal(page.data.recognizing, false)
})

test('拍照入库页面只调用识别接口，不调用采购、库存或本地业务写入', () => {
  const pageSource = fs.readFileSync(path.join(root, 'pages', 'ai-purchase', 'index.js'), 'utf8')
  const syncSource = fs.readFileSync(path.join(root, 'utils', 'server-sync.js'), 'utf8')
  assert.match(pageSource, /recognizePurchaseOrderImage/)
  assert.match(syncSource, /\/ai\/purchase-order-recognition/)
  assert.doesNotMatch(pageSource, /commitPurchase|\/store\/purchases|updateStock|addPurchase|replaceStateFromServer/)
  assert.doesNotMatch(pageSource, /selectedImage[^\n]*setStorage|setStorage[^\n]*selectedImage/)
})
