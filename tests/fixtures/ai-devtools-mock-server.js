const http = require('node:http')

const host = '127.0.0.1'
const port = Number(process.env.AI_MOCK_PORT || 3099)
let featureEnabled = false
let mode = 'unique'

const product = {
  id: 1,
  name: '水润修护精华液',
  code: 'HZ001',
  businessType: '化妆品',
  category: '护肤',
  specCount: 1,
  stock: 3,
  costPrice: 60,
  lowStockThreshold: 2,
  price: 100,
  image: '',
  updatedAt: '2026-08-18 10:00:00'
}

function candidate(overrides) {
  return {
    id: 'admin-product-1',
    adminProductId: 1,
    code: 'HZ001',
    name: '水润修护精华液',
    businessType: 'cosmetics',
    category: '护肤',
    specs: ['通用 / 100ml'],
    salePrice: 100,
    stock: 3,
    recentPurchase: { occurredAt: '2026-08-12 16:30', unitCost: 60 },
    firstPurchase: null,
    purchaseHistoryReliable: false,
    matchReasons: ['商品名称相近', '包装文字或规格匹配'],
    ...overrides
  }
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  response.end(JSON.stringify(body))
}

function recognitionResult() {
  const vision = {
    category: 'cosmetics',
    productName: '精华液',
    brand: '',
    spec: '100ml',
    visibleText: ['100ml'],
    keywords: ['精华液', '护肤'],
    confidence: 0.88
  }
  if (mode === 'none') return { ok: true, vision, matchType: 'none', items: [] }
  if (mode === 'error') return { ok: false, message: 'AI 识别服务暂时不可用' }
  if (mode === 'candidates') {
    return {
      ok: true,
      vision,
      matchType: 'candidates',
      items: [
        candidate(),
        candidate({ id: 'mock-2', adminProductId: 2, code: 'HZ002', name: '轻透防晒霜', specs: ['通用 / 50ml'], salePrice: 108, stock: 0 }),
        candidate({ id: 'mock-3', adminProductId: 3, code: 'HZ003', name: '清润爽肤水', specs: ['通用 / 200ml'], salePrice: 88, stock: 8 })
      ]
    }
  }
  return { ok: true, vision, matchType: 'unique', items: [candidate()] }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`)
  if (request.method === 'OPTIONS') return json(response, 200, {})
  if (url.pathname === '/mock/control') {
    if (url.searchParams.has('feature')) featureEnabled = url.searchParams.get('feature') === '1'
    if (['unique', 'candidates', 'none', 'error'].includes(url.searchParams.get('mode'))) mode = url.searchParams.get('mode')
    return json(response, 200, { featureEnabled, mode })
  }
  if (url.pathname === '/api/v1/health') return json(response, 200, { ok: true })
  if (url.pathname === '/api/v1/auth/wechat/login') {
    return json(response, 200, {
      ok: true,
      token: 'local-devtools-token',
      user: {
        id: 'local-user', openid: 'local-openid', name: '本地验收', role: 'owner',
        storeId: 'local-store', storeName: '本地验收店铺'
      }
    })
  }
  if (url.pathname === '/api/v1/store/state') return json(response, 200, { ok: true, exists: false, revision: 0 })
  if (url.pathname === '/api/v1/catalog/products') return json(response, 200, { ok: true, items: [product] })
  if (url.pathname === '/api/v1/features') return json(response, 200, { aiImageRecognition: featureEnabled })
  if (url.pathname === '/api/v1/ai/image-recognition' && request.method === 'POST') {
    for await (const chunk of request) void chunk
    if (!featureEnabled) return json(response, 403, { ok: false, message: 'AI 拍照识货当前未开启', details: { code: 'AI_FEATURE_DISABLED' } })
    const result = recognitionResult()
    return json(response, result.ok ? 200 : 502, result)
  }
  return json(response, 404, { ok: false, message: 'mock route not found' })
})

server.listen(port, host, () => {
  console.log(`AI DevTools mock listening on http://${host}:${port}/api/v1`)
  console.log('Feature defaults to disabled; use /mock/control?feature=1&mode=unique to enable.')
})
