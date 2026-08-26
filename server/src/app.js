const crypto = require('node:crypto')
const { signToken, verifyToken } = require('./token')
const { applyPurchase, applySale, stockOf } = require('./business-transactions')
const { createAiRecognitionService } = require('./ai-recognition')
const { createPurchaseOrderRecognitionService } = require('./purchase-order-recognition')
const { commitPurchaseBatch } = require('./batch-purchases')

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}

function sendJson(response, statusCode, body, extraHeaders) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  })
  response.end(JSON.stringify(body))
}

async function readJson(request, limitBytes) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limitBytes) throw new HttpError(413, '请求内容过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new HttpError(400, '请求 JSON 格式不正确')
  }
}

function validState(state) {
  return Boolean(
    state &&
    Array.isArray(state.products) &&
    Array.isArray(state.operations) &&
    Array.isArray(state.purchases) &&
    Array.isArray(state.sales) &&
    Array.isArray(state.manualProfits)
  )
}

function bearerToken(request) {
  const value = String(request.headers.authorization || '')
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

async function requestWechatIdentity(code, config) {
  if (!config.appId || !config.appSecret) throw new HttpError(503, '服务器尚未配置微信 AppID 和 AppSecret')
  if (!code) throw new HttpError(400, '缺少微信登录 code')
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', config.appId)
  url.searchParams.set('secret', config.appSecret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  const result = await response.json()
  if (!response.ok || !result.openid) {
    console.warn('wechat login failed', { status: response.status, errcode: result.errcode })
    throw new HttpError(401, '微信登录凭证校验失败')
  }
  return result
}

async function findOrCreateMembership(pool, identity, profile, config) {
  const allowedOpenIds = config.wechat.allowedOpenIds || []
  if (allowedOpenIds.length && !allowedOpenIds.includes(identity.openid)) {
    throw new HttpError(403, '当前微信账号未获准访问此店铺')
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const userId = crypto.randomUUID()
    const displayName = String(profile.name || '').trim().slice(0, 40) || '微信店主'
    const avatarUrl = String(profile.avatarUrl || '').slice(0, 500)
    await connection.execute(
      `INSERT INTO users (id, openid, unionid, display_name, avatar_url)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         unionid = COALESCE(VALUES(unionid), unionid),
         display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, identity.openid, identity.unionid || null, displayName, avatarUrl]
    )
    const [userRows] = await connection.execute(
      'SELECT id, openid, unionid, display_name, avatar_url FROM users WHERE openid = ? LIMIT 1',
      [identity.openid]
    )
    const user = userRows[0]
    const primaryStoreId = config.wechat.primaryStoreId
    let memberRows
    if (primaryStoreId) {
      const [storeRows] = await connection.execute(
        'SELECT id, name FROM stores WHERE id = ? AND status = ? LIMIT 1',
        [primaryStoreId, 'active']
      )
      if (!storeRows[0]) throw new HttpError(503, '小程序绑定的店铺不存在或已停用')
      await connection.execute(
        `INSERT INTO store_members (store_id, user_id, role, status)
         VALUES (?, ?, 'owner', 'active')
         ON DUPLICATE KEY UPDATE status = 'active'`,
        [primaryStoreId, user.id]
      )
      memberRows = [{ store_id: primaryStoreId, role: 'owner', store_name: storeRows[0].name }]
    } else {
      const memberResult = await connection.execute(
        `SELECT sm.store_id, sm.role, s.name AS store_name
         FROM store_members sm
         INNER JOIN stores s ON s.id = sm.store_id
         WHERE sm.user_id = ? AND sm.status = 'active'
         ORDER BY sm.created_at ASC LIMIT 1`,
        [user.id]
      )
      memberRows = memberResult[0]
    }

    let membership = memberRows[0]
    if (!membership) {
      const storeId = crypto.randomUUID()
      const storeName = `${displayName}的店铺`.slice(0, 80)
      await connection.execute('INSERT INTO stores (id, name, status) VALUES (?, ?, ?)', [storeId, storeName, 'active'])
      await connection.execute(
        'INSERT INTO store_members (store_id, user_id, role, status) VALUES (?, ?, ?, ?)',
        [storeId, user.id, 'owner', 'active']
      )
      membership = { store_id: storeId, role: 'owner', store_name: storeName }
    }

    await connection.commit()
    return {
      id: user.id,
      openid: user.openid,
      unionid: user.unionid || '',
      name: user.display_name,
      avatarUrl: user.avatar_url || '',
      storeId: membership.store_id,
      storeName: membership.store_name,
      role: membership.role
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function requireMembership(request, pool, config) {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, '请先登录')
  let payload
  try {
    payload = verifyToken(token, config.jwtSecret)
  } catch (error) {
    throw new HttpError(401, error.message)
  }
  const storeId = config.wechat.primaryStoreId || payload.storeId
  const [rows] = await pool.execute(
    `SELECT sm.role, s.name AS store_name
     FROM store_members sm
     INNER JOIN stores s ON s.id = sm.store_id
     WHERE sm.user_id = ? AND sm.store_id = ? AND sm.status = 'active' AND s.status = 'active'
     LIMIT 1`,
    [payload.userId, storeId]
  )
  if (!rows[0]) throw new HttpError(403, '当前账号已无权访问该店铺')
  return { ...payload, storeId, role: rows[0].role, storeName: rows[0].store_name }
}

function catalogProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    code: row.code,
    itemNumber: String(row.item_number || '').trim(),
    itemNumberManaged: Boolean(row.item_number_managed),
    businessType: row.business_type,
    category: row.category,
    specCount: Number(row.spec_count || 0),
    stock: Number(row.stock || 0),
    costPrice: Number(row.cost_price || 0),
    lowStockThreshold: Number(row.low_stock_threshold || 0),
    price: Number(row.price || 0),
    image: row.image_url || '',
    updatedAt: row.updated_at
  }
}

function corsHeaders(request, config) {
  const origin = String(request.headers.origin || '')
  if (!origin || !config.adminOrigins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Vary': 'Origin'
  }
}

async function commitStoreTransaction(pool, membership, kind, body, requestId) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      'SELECT state, revision FROM store_states WHERE store_id = ? FOR UPDATE',
      [membership.storeId]
    )
    if (!rows[0]) throw new HttpError(409, '服务器经营数据尚未初始化，请重新登录同步')
    const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state
    if (!validState(state)) throw new HttpError(409, '服务器经营数据格式不正确，请重新同步')

    const result = kind === 'sale'
      ? applySale(state, body, new Date())
      : applyPurchase(state, body, new Date())
    let revision = Number(rows[0].revision || 0)

    if (!result.duplicate) {
      revision += 1
      await connection.execute(
        `UPDATE store_states
         SET state = ?, revision = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE store_id = ?`,
        [JSON.stringify(result.state), revision, membership.userId, membership.storeId]
      )

      const adminProductId = Number(result.product && result.product.adminProductId || 0)
      if (adminProductId > 0) {
        const [productUpdate] = await connection.execute(
          `UPDATE admin_products
           SET stock = ?, cost_price = ?, price = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND store_id = ?`,
          [
            stockOf(result.product),
            Number(result.product.costPrice || 0),
            Number(result.product.salePrice || 0),
            adminProductId,
            membership.storeId
          ]
        )
        if (Number(productUpdate.affectedRows || 0) !== 1) {
          throw new HttpError(409, '后台商品已发生变化，请返回商品页刷新')
        }
      }

      await connection.execute(
        `INSERT INTO audit_logs
           (store_id, user_id, action, target_type, target_id, request_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          membership.storeId,
          membership.userId,
          kind === 'sale' ? 'miniapp.sale.create' : 'miniapp.purchase.create',
          kind,
          result.record.id,
          requestId,
          JSON.stringify({
            productId: result.record.productId,
            specId: result.record.specId,
            quantity: result.record.quantity,
            beforeStock: result.beforeStock,
            afterStock: result.afterStock
          })
        ]
      )
    }

    await connection.commit()
    return {
      state: result.state,
      revision,
      duplicate: result.duplicate,
      transaction: {
        recordId: result.record.id,
        productId: result.record.productId,
        specId: result.record.specId,
        productName: result.record.productName,
        specText: result.record.specText,
        quantity: result.record.quantity,
        beforeStock: result.beforeStock,
        afterStock: result.afterStock,
        unitAmount: kind === 'sale' ? result.record.unitPrice : result.record.unitCost,
        totalAmount: kind === 'sale' ? result.record.totalAmount : result.record.totalCost,
        grossProfit: kind === 'sale' ? result.record.grossProfit : null
      }
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function createRequestHandler(pool, config, dependencies) {
  const authConfigured = Boolean(config.wechat.appId && config.wechat.appSecret)
  const aiService = dependencies && dependencies.aiService
    ? dependencies.aiService
    : createAiRecognitionService(pool, config, dependencies)
  const purchaseOrderService = dependencies && dependencies.purchaseOrderService
    ? dependencies.purchaseOrderService
    : createPurchaseOrderRecognitionService(pool, config, dependencies)

  return async function handleRequest(request, response) {
    const requestId = String(request.headers['x-request-id'] || crypto.randomUUID()).slice(0, 100)
    const headers = { 'X-Request-Id': requestId, ...corsHeaders(request, config) }
    try {
      const url = new URL(request.url, 'http://127.0.0.1')

      if (request.method === 'OPTIONS') {
        response.writeHead(204, headers)
        response.end()
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/health') {
        await pool.query('SELECT 1')
        sendJson(response, 200, {
          ok: true,
          service: 'pingping-assistant-api',
          database: 'connected',
          wechatAuthConfigured: authConfigured,
          time: new Date().toISOString()
        }, headers)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/auth/wechat/login') {
        const body = await readJson(request, config.bodyLimitBytes)
        const identity = await requestWechatIdentity(body.code, config.wechat)
        const user = await findOrCreateMembership(pool, identity, body.profile || {}, config)
        const token = signToken(
          { userId: user.id, storeId: user.storeId, role: user.role },
          config.jwtSecret,
          config.tokenTtlSeconds
        )
        sendJson(response, 200, { ok: true, token, user }, headers)
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/session') {
        const membership = await requireMembership(request, pool, config)
        sendJson(response, 200, { ok: true, membership }, headers)
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/features') {
        const membership = await requireMembership(request, pool, config)
        const features = await aiService.features(membership.storeId)
        sendJson(response, 200, features, headers)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/ai/image-recognition') {
        const membership = await requireMembership(request, pool, config)
        const result = await aiService.recognize(request, membership)
        sendJson(response, 200, { ok: true, ...result }, headers)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/ai/purchase-order-recognition') {
        const membership = await requireMembership(request, pool, config)
        const result = await purchaseOrderService.recognize(request, membership)
        sendJson(response, 200, { ok: true, ...result }, headers)
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/store/state') {
        const membership = await requireMembership(request, pool, config)
        const [rows] = await pool.execute(
          'SELECT state, revision, updated_at FROM store_states WHERE store_id = ? LIMIT 1',
          [membership.storeId]
        )
        if (!rows[0]) {
          sendJson(response, 200, { ok: true, exists: false, revision: 0 }, headers)
          return
        }
        const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state
        sendJson(response, 200, {
          ok: true,
          exists: true,
          state,
          revision: Number(rows[0].revision),
          updatedAt: rows[0].updated_at
        }, headers)
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/catalog/products') {
        const membership = await requireMembership(request, pool, config)
        const [rows] = await pool.execute(
          `SELECT id, name, code, item_number, item_number_managed, business_type, category, spec_count, stock, cost_price,
                  low_stock_threshold, price, status, image_url, updated_at
           FROM admin_products
           WHERE store_id = ? AND status = '销售中'
           ORDER BY sort_order, id`,
          [membership.storeId]
        )
        sendJson(response, 200, { ok: true, items: rows.map(catalogProduct) }, headers)
        return
      }

      if (request.method === 'POST' && (url.pathname === '/api/v1/store/sales' || url.pathname === '/api/v1/store/purchases')) {
        const membership = await requireMembership(request, pool, config)
        const body = await readJson(request, config.bodyLimitBytes)
        const kind = url.pathname.endsWith('/sales') ? 'sale' : 'purchase'
        const result = await commitStoreTransaction(pool, membership, kind, body, requestId)
        sendJson(response, 200, { ok: true, ...result }, headers)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/store/purchases/batch') {
        const membership = await requireMembership(request, pool, config)
        const body = await readJson(request, config.bodyLimitBytes)
        const result = await commitPurchaseBatch(pool, membership, body, requestId)
        sendJson(response, 200, { ok: true, ...result }, headers)
        return
      }

      if (request.method === 'PUT' && url.pathname === '/api/v1/store/state') {
        const membership = await requireMembership(request, pool, config)
        const body = await readJson(request, config.bodyLimitBytes)
        if (!validState(body.state)) throw new HttpError(400, '店铺数据格式不正确')
        const requestedRevision = Number(body.revision || 0)
        const connection = await pool.getConnection()
        try {
          await connection.beginTransaction()
          const [rows] = await connection.execute(
            'SELECT revision FROM store_states WHERE store_id = ? FOR UPDATE',
            [membership.storeId]
          )
          const currentRevision = rows[0] ? Number(rows[0].revision) : 0
          if (requestedRevision !== currentRevision) {
            throw new HttpError(409, '服务器数据已被其他设备更新，请先重新同步', { currentRevision })
          }
          const nextRevision = currentRevision + 1
          if (rows[0]) {
            await connection.execute(
              `UPDATE store_states
               SET state = ?, revision = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
               WHERE store_id = ?`,
              [JSON.stringify(body.state), nextRevision, membership.userId, membership.storeId]
            )
          } else {
            await connection.execute(
              'INSERT INTO store_states (store_id, state, revision, updated_by) VALUES (?, ?, ?, ?)',
              [membership.storeId, JSON.stringify(body.state), nextRevision, membership.userId]
            )
          }
          await connection.commit()
          sendJson(response, 200, { ok: true, revision: nextRevision, updatedAt: new Date().toISOString() }, headers)
        } catch (error) {
          await connection.rollback()
          throw error
        } finally {
          connection.release()
        }
        return
      }

      throw new HttpError(404, '接口不存在')
    } catch (error) {
      const statusCode = error.statusCode || 500
      if (statusCode >= 500) console.error('request failed', { requestId, message: error.message })
      sendJson(response, statusCode, {
        ok: false,
        message: statusCode >= 500 ? '服务器处理失败，请稍后重试' : error.message,
        details: error.details,
        requestId
      }, headers)
    }
  }
}

module.exports = { createRequestHandler, validState, HttpError, catalogProduct, commitStoreTransaction, commitPurchaseBatch }
