class VisionModelError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

const SYSTEM_PROMPT = `你是零售商品图片识别器。只描述图片中可能出现的商品特征，不得推测或输出售价、进价、库存、进货日期、商品ID、盈利。只返回一个 JSON 对象，不要 Markdown。允许字段：category、productName、brand、spec、visibleText、keywords、confidence。category 只能是 clothing、cosmetics、unknown。无法判断的字符串用空字符串，数组最多 8 项。`

const USER_PROMPT = '识别这张图片中的主要零售商品，提取包装可见文字、品名、品牌和规格。不要查询或猜测任何经营数据。'

function limitedText(value, maximum, field) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new VisionModelError(502, `AI 返回的 ${field} 字段无效`)
  const text = value.trim()
  if (text.length > maximum) throw new VisionModelError(502, `AI 返回的 ${field} 字段过长`)
  return text
}

function limitedTextArray(value, field) {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') {
    const item = limitedText(value, 80, field)
    return item ? [item] : []
  }
  if (!Array.isArray(value)) throw new VisionModelError(502, `AI 返回的 ${field} 字段无效`)
  return value.map(item => limitedText(item, 80, field)).filter(Boolean).slice(0, 8)
}

function parseJsonContent(content) {
  if (typeof content !== 'string') throw new VisionModelError(502, 'AI 返回内容格式不正确')
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new VisionModelError(502, 'AI 未返回有效 JSON')
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch (error) {
    throw new VisionModelError(502, 'AI 未返回有效 JSON')
  }
}

function validateVisionResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VisionModelError(502, 'AI 返回结构不正确')
  }
  const category = limitedText(input.category, 20, 'category') || 'unknown'
  if (!['clothing', 'cosmetics', 'unknown'].includes(category)) {
    throw new VisionModelError(502, 'AI 返回的 category 字段无效')
  }
  const confidence = Number(input.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new VisionModelError(502, 'AI 返回的 confidence 字段无效')
  }
  const result = {
    category,
    productName: limitedText(input.productName, 120, 'productName'),
    brand: limitedText(input.brand, 80, 'brand'),
    spec: limitedText(input.spec, 80, 'spec'),
    visibleText: limitedTextArray(input.visibleText, 'visibleText'),
    keywords: limitedTextArray(input.keywords, 'keywords'),
    confidence
  }
  if (![result.productName, result.brand, result.spec, ...result.visibleText, ...result.keywords].some(Boolean)) {
    throw new VisionModelError(502, 'AI 未识别到可用于匹配的商品特征')
  }
  return result
}

function completionContent(payload) {
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content
  return parseJsonContent(content)
}

function createQwenVisionClient(config, fetchImpl) {
  const requestFetch = fetchImpl || global.fetch
  return {
    async recognize(image) {
      if (!config.apiKey) throw new VisionModelError(503, 'AI 服务尚未配置')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const response = await requestFetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.1,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: USER_PROMPT },
                  { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}` } }
                ]
              }
            ]
          }),
          signal: controller.signal
        })
        if (!response.ok) throw new VisionModelError(502, 'AI 识别服务暂时不可用')
        const payload = await response.json().catch(() => null)
        return validateVisionResult(completionContent(payload))
      } catch (error) {
        if (error && (error.name === 'AbortError' || controller.signal.aborted)) {
          throw new VisionModelError(504, 'AI 识别超时，请重试')
        }
        if (error instanceof VisionModelError) throw error
        throw new VisionModelError(502, 'AI 识别服务暂时不可用')
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

module.exports = {
  SYSTEM_PROMPT,
  VisionModelError,
  createQwenVisionClient,
  parseJsonContent,
  validateVisionResult
}
