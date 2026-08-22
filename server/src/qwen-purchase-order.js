const { parseJsonContent } = require('./qwen-vision')

const MAX_PURCHASE_ITEMS = 20

class PurchaseOrderModelError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

const SYSTEM_PROMPT = `你是零售采购单图片识别器。只提取图片中清晰可见的采购商品明细，不得猜测或补全。只返回一个 JSON 对象，不要 Markdown。顶层只允许 items 字段，items 最多 20 项。每项只允许字段：productName、productCode、spec、quantity、unitCost、lineTotal、confidence。quantity 无法确认时返回 null，否则必须是正整数。unitCost 和 lineTotal 仅表示采购单上清晰可见的采购单价和行金额，无法确认时返回 null，不得使用历史成本或推测值。confidence 为 0 到 1 的数字，无法判断时返回 null。禁止输出 productId、specId、库存、历史成本、利润或其他经营数据。`

const USER_PROMPT = '识别这张采购单中的商品明细，逐行提取商品名称、商品编号、规格、数量、单价和行金额。看不清的字段必须返回空字符串或 null，不要猜测。'

function limitedText(value, maximum, field) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new PurchaseOrderModelError(502, `AI 返回的 ${field} 字段无效`)
  const result = value.trim()
  if (result.length > maximum) throw new PurchaseOrderModelError(502, `AI 返回的 ${field} 字段过长`)
  return result
}

function nullablePositiveInteger(value, field) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PurchaseOrderModelError(502, `AI 返回的 ${field} 字段无效`)
  }
  return value
}

function nullableMoney(value, field) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new PurchaseOrderModelError(502, `AI 返回的 ${field} 字段无效`)
  }
  return Math.round(value * 100) / 100
}

function nullableConfidence(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PurchaseOrderModelError(502, 'AI 返回的 confidence 字段无效')
  }
  return value
}

function issueList(item) {
  const issues = []
  if (!item.productName && !item.productCode) issues.push('商品名称或编号无法确认')
  if (!item.spec) issues.push('规格无法确认')
  if (item.quantity === null) issues.push('数量无法确认')
  if (item.unitCost === null) issues.push('单价无法确认')
  if (item.lineTotal === null) issues.push('行金额无法确认')
  return issues
}

function validatePurchaseOrderResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PurchaseOrderModelError(502, 'AI 返回结构不正确')
  }
  if (!Array.isArray(input.items)) throw new PurchaseOrderModelError(502, 'AI 返回的 items 字段无效')
  if (input.items.length > MAX_PURCHASE_ITEMS) {
    throw new PurchaseOrderModelError(502, `AI 返回的采购明细不能超过 ${MAX_PURCHASE_ITEMS} 行`)
  }

  const warnings = []
  const items = input.items.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new PurchaseOrderModelError(502, `AI 返回的第 ${index + 1} 行结构无效`)
    }
    const item = {
      lineId: `line-${index + 1}`,
      productName: limitedText(source.productName, 120, 'productName'),
      productCode: limitedText(source.productCode, 80, 'productCode'),
      spec: limitedText(source.spec, 120, 'spec'),
      quantity: nullablePositiveInteger(source.quantity, 'quantity'),
      unitCost: nullableMoney(source.unitCost, 'unitCost'),
      lineTotal: nullableMoney(source.lineTotal, 'lineTotal'),
      confidence: nullableConfidence(source.confidence)
    }
    item.issues = issueList(item)
    if (item.quantity !== null && item.unitCost !== null && item.lineTotal !== null) {
      const calculated = Math.round(item.quantity * item.unitCost * 100) / 100
      if (Math.abs(calculated - item.lineTotal) > 0.01) {
        warnings.push(`第 ${index + 1} 行的数量、单价与行金额不一致，请人工核对`)
      }
    }
    return item
  })

  if (!items.length) warnings.push('未识别到采购商品明细')
  return { items, warnings }
}

function completionContent(payload) {
  const content = payload && payload.choices && payload.choices[0] &&
    payload.choices[0].message && payload.choices[0].message.content
  return parseJsonContent(content)
}

function safeLogIdentifier(value, maximum) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const result = String(value).trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, maximum)
  return result || null
}

function safeLogMessage(value, apiKey) {
  if (typeof value !== 'string') return null
  let result = value
  if (apiKey) result = result.split(apiKey).join('[REDACTED]')
  result = result
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, '[REDACTED_IMAGE]')
    .replace(/\bBearer\s+[^\s,;}"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|dashscope)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;}"']+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  return result || null
}

async function dashScopeHttpError(response, apiKey) {
  const payload = response && typeof response.json === 'function'
    ? await response.json().catch(() => null)
    : null
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const nested = root.error && typeof root.error === 'object' && !Array.isArray(root.error) ? root.error : {}
  const headerRequestId = response && response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('x-request-id') || response.headers.get('request-id')
    : null
  return {
    status: Number.isInteger(response && response.status) ? response.status : null,
    requestId: safeLogIdentifier(headerRequestId || root.request_id || root.requestId || nested.request_id, 128),
    code: safeLogIdentifier(root.code || nested.code || nested.type, 80),
    message: safeLogMessage(root.message || nested.message, apiKey)
  }
}

function logDashScopeFailure(logger, details) {
  try {
    const target = logger && typeof logger.error === 'function' ? logger : console
    target.error('dashscope purchase order request failed', details)
  } catch (error) {
    // 日志组件异常不能改变采购单识别的错误处理行为。
  }
}

function createQwenPurchaseOrderClient(config, fetchImpl, logger) {
  const requestFetch = fetchImpl || global.fetch
  return {
    async recognize(image) {
      if (!config.apiKey) throw new PurchaseOrderModelError(503, 'AI 服务尚未配置')
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
        if (!response.ok) {
          logDashScopeFailure(logger, await dashScopeHttpError(response, config.apiKey))
          throw new PurchaseOrderModelError(502, 'AI 识别服务暂时不可用')
        }
        const payload = await response.json().catch(() => null)
        return validatePurchaseOrderResult(completionContent(payload))
      } catch (error) {
        if (error && (error.name === 'AbortError' || controller.signal.aborted)) {
          logDashScopeFailure(logger, {
            status: null,
            requestId: null,
            code: safeLogIdentifier(error.name, 80),
            message: safeLogMessage(error.message, config.apiKey)
          })
          throw new PurchaseOrderModelError(504, 'AI 识别超时，请重试')
        }
        if (error instanceof PurchaseOrderModelError) throw error
        logDashScopeFailure(logger, {
          status: null,
          requestId: null,
          code: safeLogIdentifier(error && error.name, 80),
          message: safeLogMessage(error && error.message, config.apiKey)
        })
        throw new PurchaseOrderModelError(502, 'AI 识别服务暂时不可用')
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

module.exports = {
  MAX_PURCHASE_ITEMS,
  PurchaseOrderModelError,
  SYSTEM_PROMPT,
  USER_PROMPT,
  createQwenPurchaseOrderClient,
  validatePurchaseOrderResult
}
