const { readAiImageRecognitionFlag } = require('./feature-flags')
const { readImageUpload } = require('./image-upload')
const { loadBusinessProducts, matchProducts } = require('./product-matcher')
const { createQwenVisionClient } = require('./qwen-vision')

class AiRecognitionError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.statusCode = statusCode
    this.details = code ? { code } : undefined
  }
}

class AiRateLimiter {
  constructor(windowMs, maximum, now) {
    this.windowMs = windowMs
    this.maximum = maximum
    this.now = now || Date.now
    this.history = new Map()
    this.active = new Set()
  }

  async run(key, task) {
    if (this.active.has(key)) throw new AiRecognitionError(429, '识别请求正在处理中，请勿重复提交', 'AI_REQUEST_IN_PROGRESS')
    const now = this.now()
    const recent = (this.history.get(key) || []).filter(time => now - time < this.windowMs)
    if (recent.length >= this.maximum) {
      throw new AiRecognitionError(429, '识别请求过于频繁，请稍后再试', 'AI_RATE_LIMITED')
    }
    recent.push(now)
    this.history.set(key, recent)
    this.active.add(key)
    try {
      return await task()
    } finally {
      this.active.delete(key)
    }
  }
}

function createAiRecognitionService(pool, config, dependencies) {
  const deps = dependencies || {}
  const readFlag = deps.readFlag || readAiImageRecognitionFlag
  const readImage = deps.readImage || readImageUpload
  const loadProducts = deps.loadProducts || loadBusinessProducts
  const visionClient = deps.visionClient || createQwenVisionClient(config.ai, deps.fetch)
  const limiter = deps.rateLimiter || new AiRateLimiter(
    config.ai.rateLimitWindowMs,
    config.ai.rateLimitMax,
    deps.now
  )

  return {
    async features(storeId) {
      return { aiImageRecognition: await readFlag(pool, storeId) }
    },

    async recognize(request, membership) {
      const enabled = await readFlag(pool, membership.storeId)
      if (!enabled) throw new AiRecognitionError(403, 'AI 拍照识货当前未开启', 'AI_FEATURE_DISABLED')
      const image = await readImage(request, config.ai.maxImageBytes)
      if (!config.ai.apiKey) throw new AiRecognitionError(503, 'AI 服务尚未配置', 'AI_NOT_CONFIGURED')
      return limiter.run(`${membership.storeId}:${membership.userId}`, async () => {
        const vision = await visionClient.recognize(image)
        const products = await loadProducts(pool, membership.storeId)
        const matched = matchProducts(vision, products)
        return { vision, ...matched }
      })
    }
  }
}

module.exports = {
  AiRateLimiter,
  AiRecognitionError,
  createAiRecognitionService
}
