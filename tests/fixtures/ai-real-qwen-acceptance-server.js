const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createRequestHandler } = require('../../server/src/app')
const { signToken } = require('../../server/src/token')
const { detectImageMime } = require('../../server/src/image-upload')

const HOST = '127.0.0.1'
const PORT = 3101
const STORE_ID = 'local-ai-acceptance-store'
const USER_ID = 'local-ai-acceptance-user'
const ALLOWED_VISION_FIELDS = [
  'brand', 'category', 'confidence', 'keywords', 'productName', 'spec', 'visibleText'
]

const productRow = {
  id: 1,
  name: '水润修护精华液',
  code: 'HZ001',
  business_type: 'cosmetics',
  category: '护肤',
  spec_count: 1,
  stock: 3,
  price: 100
}

const state = {
  products: [{
    id: 'admin-product-1',
    adminProductId: 1,
    name: '水润修护精华液',
    code: 'HZ001',
    businessType: 'cosmetics',
    category: '护肤',
    brand: '',
    specs: [{ id: 'spec-1', color: '通用', size: '100ml', stock: 3 }],
    purchaseHistoryComplete: true
  }],
  purchases: [{
    id: 'purchase-1',
    productId: 'admin-product-1',
    createdAt: '2026-08-12 10:30:00',
    unitCost: 60
  }]
}

function readOnlyPool() {
  const statements = []
  return {
    statements,
    async query(sql) {
      statements.push(String(sql))
      if (/^\s*SELECT\s+1\s*$/i.test(sql)) return [[{ ok: 1 }], []]
      throw new Error('本地验收适配器拒绝未声明的数据库查询')
    },
    async execute(sql) {
      const statement = String(sql)
      statements.push(statement)
      if (!/^\s*SELECT\b/i.test(statement)) {
        throw new Error('本地验收适配器禁止数据库写入')
      }
      if (statement.includes('FROM store_members')) {
        return [[{ role: 'owner', store_name: '本地 AI 验收店铺' }], []]
      }
      if (statement.includes('FROM admin_products')) return [[productRow], []]
      if (statement.includes('FROM store_states')) return [[{ state }], []]
      throw new Error('本地验收适配器拒绝未声明的数据库查询')
    }
  }
}

function safeUsage(payload) {
  const usage = payload && payload.usage
  if (!usage || typeof usage !== 'object') return null
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    promptTokensDetails: usage.prompt_tokens_details ?? null
  }
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 未加载，真实验收已停止')
  }

  const pool = readOnlyPool()
  const upstream = { model: null, usage: null, requestId: null }
  const qwenFetch = async (...args) => {
    const response = await fetch(...args)
    const payload = await response.clone().json().catch(() => null)
    upstream.model = payload && payload.model ? String(payload.model) : null
    upstream.usage = safeUsage(payload)
    upstream.requestId = response.headers.get('x-request-id') ||
      (payload && (payload.request_id || payload.id)) || null
    return response
  }

  const config = {
    jwtSecret: 'local-ai-acceptance-only-secret-32-characters',
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

  const handler = createRequestHandler(pool, config, {
    readFlag: async () => true,
    fetch: qwenFetch
  })
  const server = http.createServer(handler)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, resolve)
  })

  try {
    const token = signToken({ userId: USER_ID, storeId: STORE_ID, role: 'owner' }, config.jwtSecret, 300)
    const imagePath = path.resolve(__dirname, '../../outputs/product-phase2-detail-water100.png')
    const image = fs.readFileSync(imagePath)
    const imageMime = detectImageMime(image)
    const imageExtension = imageMime === 'image/jpeg' ? 'jpg' : imageMime.split('/')[1]
    const form = new FormData()
    form.append('image', new Blob([image], { type: imageMime }), `product-acceptance.${imageExtension}`)
    const response = await fetch(`http://${HOST}:${PORT}/api/v1/ai/image-recognition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    })
    const result = await response.json()
    const visionFields = result.vision ? Object.keys(result.vision).sort() : []
    const item = Array.isArray(result.items) ? result.items[0] : null
    const allStatementsReadOnly = pool.statements.every(sql => /^\s*SELECT\b/i.test(sql))
    const businessDataVerified = Boolean(item &&
      item.salePrice === 100 &&
      item.stock === 3 &&
      item.recentPurchase &&
      item.recentPurchase.occurredAt === '2026-08-12 10:30:00' &&
      item.recentPurchase.unitCost === 60)

    console.log(JSON.stringify({
      service: { host: HOST, port: PORT, httpStatus: response.status },
      model: { configured: config.ai.model, returned: upstream.model },
      upstream: { requestId: upstream.requestId, usage: upstream.usage, feeReturned: false },
      isolation: {
        featureFlag: 'local-injected-enabled',
        databaseConnectionCreated: false,
        sqlReadOnly: allStatementsReadOnly,
        sqlStatementCount: pool.statements.length
      },
      validation: {
        visionFields,
        visualFeaturesOnly: JSON.stringify(visionFields) === JSON.stringify(ALLOWED_VISION_FIELDS),
        businessDataVerified
      },
      recognition: result.vision || null,
      matching: {
        matchType: result.matchType || null,
        item: item ? {
          id: item.id,
          name: item.name,
          salePrice: item.salePrice,
          stock: item.stock,
          recentPurchase: item.recentPurchase,
          matchReasons: item.matchReasons
        } : null
      },
      error: result.ok === false ? { message: result.message, details: result.details } : null
    }))
    if (!response.ok || !result.vision || !allStatementsReadOnly || !businessDataVerified) process.exitCode = 1
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(JSON.stringify({ acceptanceError: error.message }))
  process.exitCode = 1
})
