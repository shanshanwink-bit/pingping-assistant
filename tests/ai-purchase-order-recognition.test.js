const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const { createRequestHandler } = require('../server/src/app')
const { loadConfig } = require('../server/src/config')
const { createPurchaseOrderRecognitionService } = require('../server/src/purchase-order-recognition')
const {
  MAX_PURCHASE_ITEMS,
  SYSTEM_PROMPT,
  createQwenPurchaseOrderClient,
  validatePurchaseOrderResult
} = require('../server/src/qwen-purchase-order')
const { signToken } = require('../server/src/token')

const JWT_SECRET = 'purchase-order-test-secret-longer-than-thirty-two-characters'

function jpegBuffer(size = 20) {
  const buffer = Buffer.alloc(Math.max(12, size), 0)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  return buffer
}

function appConfig(overrides) {
  const source = {
    MYSQL_DATABASE: 'test',
    MYSQL_USER: 'test',
    MYSQL_PASSWORD: 'test',
    JWT_SECRET,
    DASHSCOPE_API_KEY: 'sk-test-purchase-order-key',
    AI_REQUEST_TIMEOUT_MS: '50',
    ...overrides
  }
  const config = loadConfig(source)
  return { ...config, jwtSecret: JWT_SECRET }
}

function clientConfig(overrides) {
  return {
    apiKey: 'sk-test-purchase-order-key',
    baseUrl: 'https://example.invalid/compatible-mode/v1',
    model: 'purchase-order-vision-model',
    timeoutMs: 50,
    ...overrides
  }
}

function responseWith(content) {
  return {
    ok: true,
    async json() { return { choices: [{ message: { content } }] } }
  }
}

function recognizedOrder(overrides) {
  return {
    items: [{
      productName: '清润爽肤水',
      productCode: 'HZ001',
      spec: '通用 / 100ml',
      businessType: 'cosmetics',
      quantity: 5,
      unitCost: 60,
      lineTotal: 300,
      confidence: 0.92,
      ...overrides
    }]
  }
}

async function invoke(handler, token) {
  const request = Readable.from([])
  request.method = 'POST'
  request.url = '/api/v1/ai/purchase-order-recognition'
  request.headers = token ? { authorization: `Bearer ${token}` } : {}
  let statusCode = 0
  let body = ''
  const response = {
    writeHead(status, headers) { statusCode = status; this.headers = headers },
    end(value) { body = value || '' }
  }
  await handler(request, response)
  return { statusCode, body: body ? JSON.parse(body) : {} }
}

test('正常采购单图片 mock 返回受控 JSON 和服务端 lineId', async () => {
  let requestBody
  const client = createQwenPurchaseOrderClient(clientConfig(), async (url, options) => {
    requestBody = JSON.parse(options.body)
    return responseWith(JSON.stringify(recognizedOrder()))
  })
  const result = await client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer() })

  assert.deepEqual(result, {
    items: [{
      lineId: 'line-1',
      productName: '清润爽肤水',
      productCode: 'HZ001',
      spec: '通用 / 100ml',
      businessType: 'cosmetics',
      quantity: 5,
      unitCost: 60,
      lineTotal: 300,
      confidence: 0.92,
      issues: []
    }],
    warnings: []
  })
  assert.equal(requestBody.model, 'purchase-order-vision-model')
  assert.match(requestBody.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/)
  assert.match(SYSTEM_PROMPT, /不得猜测或补全/)
  assert.match(SYSTEM_PROMPT, /吊牌货号、商品编码或供应商货号/)
  assert.match(SYSTEM_PROMPT, /productId、adminProductId、specId、内部流水号 code/)
})

test('AI 返回 Markdown 包裹 JSON 时可安全解析', async () => {
  const content = `\`\`\`json\n${JSON.stringify(recognizedOrder())}\n\`\`\``
  const client = createQwenPurchaseOrderClient(clientConfig(), async () => responseWith(content))
  const result = await client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer() })
  assert.equal(result.items[0].lineId, 'line-1')
  assert.equal(result.items[0].productName, '清润爽肤水')
})

test('AI 缺少字段时返回 null、空字符串和明确 issues', () => {
  const result = validatePurchaseOrderResult({ items: [{}] })
  assert.deepEqual(result.items[0], {
    lineId: 'line-1',
    productName: '',
    productCode: '',
    spec: '',
    businessType: 'unknown',
    quantity: null,
    unitCost: null,
    lineTotal: null,
    confidence: null,
    issues: [
      '商品名称或货号无法确认',
      '规格无法确认',
      '数量无法确认',
      '单价无法确认',
      '行金额无法确认'
    ]
  })
})

test('AI 返回禁止字段时白名单丢弃且不作为经营数据返回', () => {
  const result = validatePurchaseOrderResult(recognizedOrder({
    productId: 'ai-product-id',
    adminProductId: 12,
    specId: 'ai-spec-id',
    code: '0001',
    stock: 999,
    cost: 1,
    profit: 998
  }))
  const item = result.items[0]
  assert.equal(Object.hasOwn(item, 'productId'), false)
  assert.equal(Object.hasOwn(item, 'adminProductId'), false)
  assert.equal(Object.hasOwn(item, 'specId'), false)
  assert.equal(Object.hasOwn(item, 'code'), false)
  assert.equal(Object.hasOwn(item, 'stock'), false)
  assert.equal(Object.hasOwn(item, 'cost'), false)
  assert.equal(Object.hasOwn(item, 'profit'), false)
})

test('AI 返回错误字段类型时拒绝', () => {
  assert.throws(
    () => validatePurchaseOrderResult(recognizedOrder({ quantity: '5' })),
    error => error.statusCode === 502 && /quantity/.test(error.message)
  )
  assert.throws(
    () => validatePurchaseOrderResult(recognizedOrder({ unitCost: -1 })),
    error => error.statusCode === 502 && /unitCost/.test(error.message)
  )
  assert.throws(
    () => validatePurchaseOrderResult(recognizedOrder({ businessType: 'food' })),
    error => error.statusCode === 502 && /businessType/.test(error.message)
  )
})

test('AI 返回超过 20 行采购明细时拒绝', () => {
  const item = recognizedOrder().items[0]
  const items = Array.from({ length: MAX_PURCHASE_ITEMS + 1 }, () => ({ ...item }))
  assert.throws(
    () => validatePurchaseOrderResult({ items }),
    error => error.statusCode === 502 && /不能超过 20 行/.test(error.message)
  )
})

test('数量乘单价与行金额不一致时返回人工核对警告', () => {
  const result = validatePurchaseOrderResult(recognizedOrder({ lineTotal: 299 }))
  assert.deepEqual(result.warnings, ['第 1 行的数量、单价与行金额不一致，请人工核对'])
})

test('Feature Flag 关闭时接口返回 403 且不读取图片或调用模型', async () => {
  let imageRead = false
  let modelCalled = false
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM store_members')) return [[{ role: 'owner', store_name: '测试店铺' }]]
      if (sql.includes('FROM admin_settings')) return [[{ enabled: 0 }]]
      throw new Error(`unexpected query: ${sql}`)
    }
  }
  const handler = createRequestHandler(pool, appConfig(), {
    readImage: async () => { imageRead = true },
    purchaseOrderVisionClient: { recognize: async () => { modelCalled = true } }
  })
  const token = signToken({ userId: 'user-a', storeId: 'store-a', role: 'owner' }, JWT_SECRET, 60)
  const result = await invoke(handler, token)

  assert.equal(result.statusCode, 403)
  assert.equal(result.body.details.code, 'AI_FEATURE_DISABLED')
  assert.equal(imageRead, false)
  assert.equal(modelCalled, false)
})

test('API Key 不存在时不调用采购单模型', async () => {
  let modelCalled = false
  const config = appConfig({ DASHSCOPE_API_KEY: '' })
  const service = createPurchaseOrderRecognitionService({}, config, {
    readFlag: async () => true,
    readImage: async () => ({ mime: 'image/jpeg', buffer: jpegBuffer() }),
    purchaseOrderVisionClient: { recognize: async () => { modelCalled = true } }
  })
  await assert.rejects(
    () => service.recognize({}, { storeId: 'store-a', userId: 'user-a' }),
    error => error.statusCode === 503 && error.details.code === 'AI_NOT_CONFIGURED'
  )
  assert.equal(modelCalled, false)
})

test('采购单识别接口只执行登录和开关读取，不执行数据库写入', async () => {
  const queries = []
  const pool = {
    async execute(sql, args) {
      queries.push({ sql, args })
      if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)\b/i.test(sql)) {
        throw new Error(`write query is forbidden: ${sql}`)
      }
      if (sql.includes('FROM store_members')) return [[{ role: 'owner', store_name: '测试店铺' }]]
      if (sql.includes('FROM admin_settings')) return [[{ enabled: 1 }]]
      if (sql.includes('FROM admin_products')) return [[{ id: 1, code: 'HZ001', status: '销售中' }]]
      if (sql.includes('FROM store_states')) return [[{ state: JSON.stringify({
        products: [{
          id: 'water-100', code: 'HZ001', name: '清润爽肤水', businessType: 'cosmetics',
          specs: [{ id: 'spec-100', color: '通用', size: '100ml', stock: 3 }]
        }]
      }) }]]
      throw new Error(`unexpected query: ${sql}`)
    }
  }
  const handler = createRequestHandler(pool, appConfig(), {
    readImage: async () => ({ mime: 'image/jpeg', buffer: jpegBuffer() }),
    purchaseOrderVisionClient: { recognize: async () => validatePurchaseOrderResult(recognizedOrder()) }
  })
  const token = signToken({ userId: 'user-a', storeId: 'store-a', role: 'owner' }, JWT_SECRET, 60)
  const result = await invoke(handler, token)

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.items[0].lineId, 'line-1')
  assert.equal(result.body.draft.items[0].productId, 'water-100')
  assert.equal(result.body.draft.items[0].specId, 'spec-100')
      assert.equal(queries.length, 4)
  assert.ok(queries.every(call => /^\s*SELECT\b/i.test(call.sql)))
})

test('千问 HTTP 错误日志脱敏且不向调用方返回原始错误', async () => {
  const apiKey = 'sk-sensitive-purchase-order-key'
  const logs = []
  const client = createQwenPurchaseOrderClient(clientConfig({ apiKey }), async () => ({
    ok: false,
    status: 401,
    headers: { get: name => name === 'x-request-id' ? 'req-purchase-1' : null },
    async json() {
      return {
        error: {
          code: 'InvalidApiKey',
          message: `Bearer ${apiKey}\nimage=data:image/png;base64,AAAA1111`
        }
      }
    }
  }), { error: (...args) => logs.push(args) })

  await assert.rejects(
    () => client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer() }),
    error => error.statusCode === 502 && error.message === 'AI 识别服务暂时不可用'
  )
  const serialized = JSON.stringify(logs)
  assert.doesNotMatch(serialized, /sk-sensitive-purchase-order-key/)
  assert.doesNotMatch(serialized, /AAAA1111/)
  assert.match(serialized, /REDACTED/)
})
