const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { test } = require('node:test')
const { AiRateLimiter, createAiRecognitionService } = require('../server/src/ai-recognition')
const { createRequestHandler } = require('../server/src/app')
const { loadConfig } = require('../server/src/config')
const { readAiImageRecognitionFlag } = require('../server/src/feature-flags')
const { signToken } = require('../server/src/token')

const JWT_SECRET = 'feature-test-secret-longer-than-thirty-two-characters'

function flagPool(rows, failure, calls) {
  return {
    async execute(sql, args) {
      if (calls) calls.push({ sql, args })
      if (failure) throw failure
      return [rows]
    }
  }
}

function appConfig() {
  const config = loadConfig({
    MYSQL_DATABASE: 'test',
    MYSQL_USER: 'test',
    MYSQL_PASSWORD: 'test',
    JWT_SECRET,
    AI_REQUEST_TIMEOUT_MS: '20'
  })
  return { ...config, jwtSecret: JWT_SECRET }
}

async function invoke(handler, method, path, token) {
  const request = Readable.from([])
  request.method = method
  request.url = path
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

function featureApiPool(enabled) {
  return {
    async execute(sql, args) {
      if (sql.includes('FROM store_members')) return [[{ role: 'owner', store_name: '测试店铺' }]]
      if (sql.includes('FROM admin_settings')) return [[{ enabled }]]
      throw new Error(`unexpected query: ${sql}`)
    }
  }
}

test('enabled = 0 时功能关闭', async () => {
  assert.equal(await readAiImageRecognitionFlag(flagPool([{ enabled: 0 }]), 'store-a'), false)
})

test('enabled = 1 时功能开启', async () => {
  assert.equal(await readAiImageRecognitionFlag(flagPool([{ enabled: 1 }]), 'store-a'), true)
})

test('配置不存在时 fail closed', async () => {
  assert.equal(await readAiImageRecognitionFlag(flagPool([]), 'store-a'), false)
})

test('数据库读取失败时 fail closed', async () => {
  assert.equal(await readAiImageRecognitionFlag(flagPool([], new Error('db unavailable')), 'store-a'), false)
})

test('异常 enabled 值不会被宽松转换', async () => {
  for (const enabled of ['1', true, 2, null, undefined]) {
    assert.equal(await readAiImageRecognitionFlag(flagPool([{ enabled }]), 'store-a'), false)
  }
})

test('Feature Flag 查询严格使用传入 storeId', async () => {
  const calls = []
  await readAiImageRecognitionFlag(flagPool([{ enabled: 1 }], null, calls), 'store-b')
  assert.equal(calls[0].args[0], 'store-b')
  assert.deepEqual(calls[0].args.slice(1), ['ai', 'ai_image_recognition_enabled'])
})

test('Feature API 返回 true 且不暴露内部配置', async () => {
  const token = signToken({ userId: 'user-a', storeId: 'store-a', role: 'owner' }, JWT_SECRET, 60)
  const result = await invoke(createRequestHandler(featureApiPool(1), appConfig()), 'GET', '/api/v1/features', token)
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body, { aiImageRecognition: true })
})

test('Feature API 返回 false', async () => {
  const token = signToken({ userId: 'user-a', storeId: 'store-a', role: 'owner' }, JWT_SECRET, 60)
  const result = await invoke(createRequestHandler(featureApiPool(0), appConfig()), 'GET', '/api/v1/features', token)
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body, { aiImageRecognition: false })
})

test('公开 AI HTTP 接口在开关关闭时直接返回 403', async () => {
  const token = signToken({ userId: 'user-a', storeId: 'store-a', role: 'owner' }, JWT_SECRET, 60)
  const result = await invoke(createRequestHandler(featureApiPool(0), appConfig()), 'POST', '/api/v1/ai/image-recognition', token)
  assert.equal(result.statusCode, 403)
  assert.equal(result.body.details.code, 'AI_FEATURE_DISABLED')
})

test('开关关闭时 AI API 在读取图片前拒绝', async () => {
  let imageRead = false
  const service = createAiRecognitionService({}, { ai: { apiKey: String(true), maxImageBytes: 100, rateLimitWindowMs: 1000, rateLimitMax: 2 } }, {
    readFlag: async () => false,
    readImage: async () => { imageRead = true },
    visionClient: { recognize: async () => ({}) }
  })
  await assert.rejects(() => service.recognize({}, { storeId: 's1', userId: 'u1' }), error => {
    assert.equal(error.statusCode, 403)
    assert.equal(error.details.code, 'AI_FEATURE_DISABLED')
    return true
  })
  assert.equal(imageRead, false)
})

test('缺少 DASHSCOPE_API_KEY 时不调用模型', async () => {
  let called = false
  const service = createAiRecognitionService({}, { ai: { apiKey: '', maxImageBytes: 100, rateLimitWindowMs: 1000, rateLimitMax: 2 } }, {
    readFlag: async () => true,
    readImage: async () => ({ buffer: Buffer.alloc(12), mime: 'image/jpeg' }),
    visionClient: { recognize: async () => { called = true } }
  })
  await assert.rejects(() => service.recognize({}, { storeId: 's1', userId: 'u1' }), error => error.statusCode === 503)
  assert.equal(called, false)
})

test('页面打开后开关被关闭，下一次识别仍被拒绝', async () => {
  let enabled = true
  let called = false
  const service = createAiRecognitionService({}, { ai: { apiKey: String(true), maxImageBytes: 100, rateLimitWindowMs: 1000, rateLimitMax: 2 } }, {
    readFlag: async () => enabled,
    readImage: async () => ({ buffer: Buffer.alloc(12), mime: 'image/jpeg' }),
    visionClient: { recognize: async () => { called = true } }
  })
  assert.deepEqual(await service.features('s1'), { aiImageRecognition: true })
  enabled = false
  await assert.rejects(() => service.recognize({}, { storeId: 's1', userId: 'u1' }), error => error.statusCode === 403)
  assert.equal(called, false)
})

test('同一用户并发重复提交会被拒绝', async () => {
  let release
  const limiter = new AiRateLimiter(60000, 6, () => 100)
  const first = limiter.run('s1:u1', () => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(() => limiter.run('s1:u1', async () => true), error => error.statusCode === 429)
  release(true)
  assert.equal(await first, true)
})

test('单用户分钟频率限制生效且不影响其他用户', async () => {
  const limiter = new AiRateLimiter(60000, 1, () => 100)
  await limiter.run('s1:u1', async () => true)
  await assert.rejects(() => limiter.run('s1:u1', async () => true), error => error.details.code === 'AI_RATE_LIMITED')
  assert.equal(await limiter.run('s1:u2', async () => true), true)
})
