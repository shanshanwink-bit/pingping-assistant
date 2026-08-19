const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const { detectImageMime, readImageUpload } = require('../server/src/image-upload')
const { createQwenVisionClient, parseJsonContent, validateVisionResult } = require('../server/src/qwen-vision')
const { validateSelectedImage } = require('../utils/ai-image')

function jpegBuffer(size) {
  const buffer = Buffer.alloc(Math.max(12, size), 0)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  return buffer
}

function multipartRequest(buffer, declaredMime) {
  const boundary = 'pingping-test-boundary'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="product.jpg"\r\nContent-Type: ${declaredMime}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  const request = Readable.from([body])
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length)
  }
  return request
}

function clientConfig(overrides) {
  return {
    apiKey: String(true),
    baseUrl: 'https://example.invalid/compatible-mode/v1',
    model: 'vision-model-from-config',
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

test('合法 JPG multipart 图片可读取且不落盘', async () => {
  const image = await readImageUpload(multipartRequest(jpegBuffer(80), 'image/jpeg'), 1024)
  assert.equal(image.mime, 'image/jpeg')
  assert.equal(image.buffer.length, 80)
})

test('图片超过最大体积时拒绝', async () => {
  await assert.rejects(() => readImageUpload(multipartRequest(jpegBuffer(300), 'image/jpeg'), 100), error => error.statusCode === 413)
})

test('不支持的图片格式会被真实文件头识别并拒绝', async () => {
  const gif = Buffer.from('GIF89a-not-supported')
  assert.equal(detectImageMime(gif), '')
  await assert.rejects(() => readImageUpload(multipartRequest(gif, 'image/gif'), 1024), error => error.statusCode === 415)
})

test('客户端选择阶段拒绝非图片扩展名', () => {
  assert.throws(() => validateSelectedImage({ tempFilePath: '/tmp/file.txt', size: 10, fileType: 'image' }), /JPG/)
})

test('正常 AI JSON 会转换为受控视觉特征', async () => {
  let requestBody
  const client = createQwenVisionClient(clientConfig(), async (url, options) => {
    requestBody = JSON.parse(options.body)
    return responseWith(JSON.stringify({
      category: 'cosmetics', productName: '爽肤水', brand: '', spec: '100ml',
      visibleText: ['100ml'], keywords: ['爽肤水'], confidence: 0.86
    }))
  })
  const result = await client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer(20) })
  assert.equal(result.productName, '爽肤水')
  assert.equal(requestBody.model, 'vision-model-from-config')
  assert.match(requestBody.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/)
})

test('AI 返回 Markdown 包裹 JSON 时可安全提取', () => {
  assert.deepEqual(parseJsonContent('```json\n{"category":"unknown"}\n```'), { category: 'unknown' })
})

test('AI 返回单个可见文字时规范化为受限数组', () => {
  const result = validateVisionResult({
    category: 'cosmetics', productName: '精华液', brand: '', spec: '100ml',
    visibleText: '水润修护', keywords: '护肤', confidence: 0.88
  })
  assert.deepEqual(result.visibleText, ['水润修护'])
  assert.deepEqual(result.keywords, ['护肤'])
})

test('AI 返回过多可见文字时安全截取前 8 项', () => {
  const visibleText = Array.from({ length: 10 }, (_, index) => `文字${index + 1}`)
  const result = validateVisionResult({
    category: 'cosmetics', productName: '精华液', visibleText, keywords: [], confidence: 0.8
  })
  assert.equal(result.visibleText.length, 8)
  assert.deepEqual(result.visibleText, visibleText.slice(0, 8))
})

test('AI 返回非 JSON 时拒绝', async () => {
  const client = createQwenVisionClient(clientConfig(), async () => responseWith('这是一瓶爽肤水'))
  await assert.rejects(() => client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer(20) }), /有效 JSON/)
})

test('AI 字段类型或 confidence 异常时拒绝', () => {
  assert.throws(() => validateVisionResult({
    category: 'cosmetics', productName: ['错误'], confidence: 2, visibleText: [], keywords: []
  }), /confidence|productName/)
})

test('AI 即使返回价格和库存也会被白名单丢弃', () => {
  const result = validateVisionResult({
    category: 'cosmetics', productName: '爽肤水', brand: '', spec: '100ml',
    visibleText: [], keywords: ['爽肤水'], confidence: 0.9,
    price: 999, stock: 888, purchaseDate: '2099-01-01'
  })
  assert.equal(Object.hasOwn(result, 'price'), false)
  assert.equal(Object.hasOwn(result, 'stock'), false)
  assert.equal(Object.hasOwn(result, 'purchaseDate'), false)
})

test('千问请求超时会返回明确错误', async () => {
  const logger = { error() {} }
  const client = createQwenVisionClient(clientConfig({ timeoutMs: 5 }), async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  }), logger)
  await assert.rejects(() => client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer(20) }), error => error.statusCode === 504)
})

test('千问 HTTP 失败不会把上游响应透传给小程序', async () => {
  const logs = []
  const logger = { error: (...args) => logs.push(args) }
  const client = createQwenVisionClient(clientConfig(), async () => ({ ok: false, status: 500 }), logger)
  await assert.rejects(() => client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer(20) }), error => {
    assert.equal(error.statusCode, 502)
    assert.equal(error.message, 'AI 识别服务暂时不可用')
    return true
  })
  assert.deepEqual(logs, [[
    'dashscope request failed',
    { status: 500, requestId: null, code: null, message: null }
  ]])
})

test('千问 HTTP 失败日志记录受控上游字段并脱敏', async () => {
  const apiKey = 'sk-sensitive-api-key-value'
  const logs = []
  const logger = { error: (...args) => logs.push(args) }
  const client = createQwenVisionClient(clientConfig({ apiKey }), async () => ({
    ok: false,
    status: 401,
    headers: {
      get(name) { return name === 'x-request-id' ? 'req-safe-123' : null }
    },
    async json() {
      return {
        request_id: 'body-request-id',
        error: {
          code: 'InvalidApiKey',
          message: `Authorization: Bearer ${apiKey}\nimage=data:image/png;base64,AAAA1111`
        }
      }
    }
  }), logger)

  await assert.rejects(
    () => client.recognize({ mime: 'image/jpeg', buffer: jpegBuffer(20) }),
    error => error.statusCode === 502 && error.message === 'AI 识别服务暂时不可用'
  )

  assert.deepEqual(logs, [[
    'dashscope request failed',
    {
      status: 401,
      requestId: 'req-safe-123',
      code: 'InvalidApiKey',
      message: 'Authorization: Bearer [REDACTED] image=[REDACTED_IMAGE]'
    }
  ]])
  const serialized = JSON.stringify(logs)
  assert.doesNotMatch(serialized, /sk-sensitive-api-key-value/)
  assert.doesNotMatch(serialized, /AAAA1111/)
})
