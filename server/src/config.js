function required(name, value) {
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

function positiveInteger(name, value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`)
  return parsed
}

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function loadConfig(env) {
  const source = env || process.env
  const port = Number(source.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口')

  const jwtSecret = required('JWT_SECRET', source.JWT_SECRET)
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET 长度不能少于 32 个字符')

  const primaryStoreId = String(source.PRIMARY_STORE_ID || '').trim()
  const allowedOpenIds = String(source.WECHAT_ALLOWED_OPENIDS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (primaryStoreId && !allowedOpenIds.length) {
    throw new Error('配置 PRIMARY_STORE_ID 时必须同时配置 WECHAT_ALLOWED_OPENIDS')
  }

  const demoEnabled = enabled(source.DEMO_LOGIN_ENABLED)
  const demoStoreId = String(source.DEMO_STORE_ID || '').trim()
  const demoUserId = String(source.DEMO_USER_ID || '').trim()
  if (demoEnabled && (!demoStoreId || !demoUserId)) {
    throw new Error('启用体验登录时必须同时配置 DEMO_STORE_ID 和 DEMO_USER_ID')
  }

  return {
    nodeEnv: source.NODE_ENV || 'production',
    host: source.HOST || '127.0.0.1',
    port,
    mysql: {
      host: source.MYSQL_HOST || '127.0.0.1',
      port: Number(source.MYSQL_PORT || 3306),
      database: required('MYSQL_DATABASE', source.MYSQL_DATABASE),
      user: required('MYSQL_USER', source.MYSQL_USER),
      password: required('MYSQL_PASSWORD', source.MYSQL_PASSWORD),
      connectionLimit: Number(source.MYSQL_CONNECTION_LIMIT || 8)
    },
    wechat: {
      appId: source.WECHAT_APP_ID || '',
      appSecret: source.WECHAT_APP_SECRET || '',
      primaryStoreId,
      allowedOpenIds
    },
    demo: {
      enabled: demoEnabled,
      storeId: demoStoreId,
      userId: demoUserId,
      tokenTtlSeconds: positiveInteger('DEMO_TOKEN_TTL_SECONDS', source.DEMO_TOKEN_TTL_SECONDS || 60 * 60 * 2)
    },
    ai: {
      apiKey: String(source.DASHSCOPE_API_KEY || '').trim(),
      baseUrl: String(source.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
      model: String(source.QWEN_VISION_MODEL || 'qwen3.7-plus').trim(),
      timeoutMs: positiveInteger('AI_REQUEST_TIMEOUT_MS', source.AI_REQUEST_TIMEOUT_MS || 15000),
      maxImageBytes: positiveInteger('AI_MAX_IMAGE_BYTES', source.AI_MAX_IMAGE_BYTES || 4 * 1024 * 1024),
      rateLimitWindowMs: positiveInteger('AI_RATE_LIMIT_WINDOW_MS', source.AI_RATE_LIMIT_WINDOW_MS || 60000),
      rateLimitMax: positiveInteger('AI_RATE_LIMIT_MAX', source.AI_RATE_LIMIT_MAX || 6)
    },
    adminOrigins: String(source.ADMIN_ORIGINS || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    tokenTtlSeconds: Number(source.TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30),
    bodyLimitBytes: Number(source.BODY_LIMIT_BYTES || 3 * 1024 * 1024)
  }
}

module.exports = { loadConfig }
