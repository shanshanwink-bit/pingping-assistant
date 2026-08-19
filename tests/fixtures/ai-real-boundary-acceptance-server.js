const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createRequestHandler } = require('../../server/src/app')
const { detectImageMime } = require('../../server/src/image-upload')
const { signToken } = require('../../server/src/token')

const HOST = '127.0.0.1'
const PORT = 3102
const STORE_ID = 'local-ai-boundary-store'
const USER_ID = 'local-ai-boundary-user'

const products = [
  { id: 1, name: '水润修护精华液', code: 'HZ001', business_type: 'cosmetics', category: '护肤', spec_count: 1, stock: 3, price: 100 },
  { id: 2, name: '水润保湿精华液', code: 'HZ002', business_type: 'cosmetics', category: '护肤', spec_count: 1, stock: 0, price: 108 },
  { id: 3, name: '清润补水精华液', code: 'HZ003', business_type: 'cosmetics', category: '护肤', spec_count: 1, stock: 8, price: 88 },
  { id: 4, name: '黑色修身连衣裙', code: 'FZ001', business_type: 'clothing', category: '连衣裙', spec_count: 1, stock: 5, price: 199 }
]

const state = {
  products: products.map(item => ({
    id: `admin-product-${item.id}`,
    adminProductId: item.id,
    name: item.name,
    code: item.code,
    businessType: item.business_type,
    category: item.category,
    specs: [{ id: `spec-${item.id}`, color: '通用', size: item.business_type === 'cosmetics' ? '100ml' : 'M', stock: item.stock }],
    purchaseHistoryComplete: true
  })),
  purchases: [
    { id: 'pu-1', productId: 'admin-product-1', createdAt: '2026-08-12 10:30:00', unitCost: 60 },
    { id: 'pu-2', productId: 'admin-product-2', createdAt: '2026-08-11 09:20:00', unitCost: 66 },
    { id: 'pu-3', productId: 'admin-product-3', createdAt: '2026-08-10 15:40:00', unitCost: 52 }
  ]
}

function readOnlyPool() {
  const statements = []
  return {
    statements,
    async query(sql) {
      statements.push(String(sql))
      if (/^\s*SELECT\s+1\s*$/i.test(sql)) return [[{ ok: 1 }], []]
      throw new Error('本地边界验收适配器拒绝未声明的查询')
    },
    async execute(sql) {
      const statement = String(sql)
      statements.push(statement)
      if (!/^\s*SELECT\b/i.test(statement)) throw new Error('本地边界验收适配器禁止数据库写入')
      if (statement.includes('FROM store_members')) return [[{ role: 'owner', store_name: '本地边界验收店铺' }], []]
      if (statement.includes('FROM admin_products')) return [products, []]
      if (statement.includes('FROM store_states')) return [[{ state }], []]
      throw new Error('本地边界验收适配器拒绝未声明的查询')
    }
  }
}

function usageOf(payload) {
  const usage = payload && payload.usage
  if (!usage) return null
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    imageTokens: (usage.prompt_tokens_details && usage.prompt_tokens_details.image_tokens) ?? null,
    textTokens: (usage.prompt_tokens_details && usage.prompt_tokens_details.text_tokens) ?? null,
    cachedTokens: (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ?? null
  }
}

function config() {
  if (!process.env.DASHSCOPE_API_KEY) throw new Error('DASHSCOPE_API_KEY 未加载，边界验收停止')
  return {
    jwtSecret: 'local-ai-boundary-only-secret-32-characters',
    tokenTtlSeconds: 300,
    bodyLimitBytes: 4 * 1024 * 1024,
    adminOrigins: [],
    wechat: { appId: '', appSecret: '', primaryStoreId: '', allowedOpenIds: [] },
    ai: {
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseUrl: String(process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
      model: String(process.env.QWEN_VISION_MODEL || 'qwen3-vl-plus'),
      timeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000),
      maxImageBytes: 4 * 1024 * 1024,
      rateLimitWindowMs: 60000,
      rateLimitMax: 6
    }
  }
}

async function postImage(token, filename) {
  const image = fs.readFileSync(filename)
  const mime = detectImageMime(image)
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
  const form = new FormData()
  form.append('image', new Blob([image], { type: mime }), `boundary.${extension}`)
  const response = await fetch(`http://${HOST}:${PORT}/api/v1/ai/image-recognition`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  })
  return { status: response.status, body: await response.json() }
}

function scenarioResult(name, response, upstream) {
  return {
    name,
    httpStatus: response.status,
    model: upstream.model,
    requestId: upstream.requestId,
    usage: upstream.usage,
    feeReturned: false,
    vision: response.body.vision || null,
    matchType: response.body.matchType || null,
    candidates: (response.body.items || []).map(item => ({
      name: item.name,
      matchScore: item.matchScore,
      matchReasons: item.matchReasons,
      salePrice: item.salePrice,
      stock: item.stock,
      recentPurchase: item.recentPurchase
    })),
    error: response.body.ok === false ? { message: response.body.message, details: response.body.details } : null
  }
}

async function main() {
  const cfg = config()
  const pool = readOnlyPool()
  const upstreamCalls = []
  const qwenFetch = async (...args) => {
    const response = await fetch(...args)
    const payload = await response.clone().json().catch(() => null)
    upstreamCalls.push({
      model: payload && payload.model ? String(payload.model) : null,
      requestId: response.headers.get('x-request-id') || (payload && (payload.request_id || payload.id)) || null,
      usage: usageOf(payload)
    })
    return response
  }
  const handler = createRequestHandler(pool, cfg, { readFlag: async () => true, fetch: qwenFetch })
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, resolve)
  })

  try {
    const token = signToken({ userId: USER_ID, storeId: STORE_ID, role: 'owner' }, cfg.jwtSecret, 300)
    const similar = await postImage(token, path.resolve(__dirname, '../../outputs/ai-boundary-serum.jpg'))
    const unrelated = await postImage(token, path.resolve(__dirname, '../../outputs/ai-boundary-mouse.jpg'))
    const similarResult = scenarioResult('similar-products', similar, upstreamCalls[0] || {})
    const unrelatedResult = scenarioResult('unrelated-product', unrelated, upstreamCalls[1] || {})
    const sqlReadOnly = pool.statements.every(sql => /^\s*SELECT\b/i.test(sql))
    const scoresSorted = similarResult.candidates.every((item, index, items) => index === 0 || items[index - 1].matchScore >= item.matchScore)
    const accepted = similar.status === 200 &&
      similarResult.matchType === 'candidates' &&
      similarResult.candidates.length > 0 &&
      similarResult.candidates.length <= 3 &&
      scoresSorted &&
      unrelated.status === 200 &&
      unrelatedResult.matchType === 'none' &&
      unrelatedResult.candidates.length === 0 &&
      sqlReadOnly

    console.log(JSON.stringify({
      service: { host: HOST, port: PORT, modelConfigured: cfg.ai.model },
      isolation: {
        featureFlag: 'local-injected-enabled', databaseConnectionCreated: false,
        sqlReadOnly, sqlStatementCount: pool.statements.length
      },
      validation: {
        similarAvoidedUnique: similarResult.matchType !== 'unique',
        candidateLimitRespected: similarResult.candidates.length <= 3,
        scoresSorted,
        unrelatedReturnedNone: unrelatedResult.matchType === 'none',
        noProductCreated: true
      },
      scenarios: [similarResult, unrelatedResult]
    }))
    if (!accepted) process.exitCode = 1
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(JSON.stringify({ acceptanceError: error.message }))
  process.exitCode = 1
})
