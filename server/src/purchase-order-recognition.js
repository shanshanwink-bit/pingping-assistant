const { AiRateLimiter, AiRecognitionError } = require('./ai-recognition')
const { readAiImageRecognitionFlag } = require('./feature-flags')
const { readImageUpload } = require('./image-upload')
const { createQwenPurchaseOrderClient } = require('./qwen-purchase-order')
const { createPurchaseDraft } = require('./purchase-draft')

function createPurchaseOrderRecognitionService(pool, config, dependencies) {
  const deps = dependencies || {}
  const readFlag = deps.readFlag || readAiImageRecognitionFlag
  const readImage = deps.readImage || readImageUpload
  const visionClient = deps.purchaseOrderVisionClient || createQwenPurchaseOrderClient(config.ai, deps.fetch)
  const buildDraft = deps.createPurchaseDraft || createPurchaseDraft
  const limiter = deps.purchaseOrderRateLimiter || new AiRateLimiter(
    config.ai.rateLimitWindowMs,
    config.ai.rateLimitMax,
    deps.now
  )

  return {
    async recognize(request, membership) {
      const enabled = await readFlag(pool, membership.storeId)
      if (!enabled) throw new AiRecognitionError(403, 'AI 商品助手当前未开启', 'AI_FEATURE_DISABLED')
      const image = await readImage(request, config.ai.maxImageBytes)
      if (!config.ai.apiKey) throw new AiRecognitionError(503, 'AI 服务尚未配置', 'AI_NOT_CONFIGURED')
      const recognition = await limiter.run(
        `${membership.storeId}:${membership.userId}`,
        () => visionClient.recognize(image)
      )
      const draft = await buildDraft(pool, membership.storeId, recognition, deps)
      return { ...recognition, draft }
    }
  }
}

module.exports = { createPurchaseOrderRecognitionService }
