function required(name, value) {
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
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
    adminOrigins: String(source.ADMIN_ORIGINS || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
    tokenTtlSeconds: Number(source.TOKEN_TTL_SECONDS || 60 * 60 * 24 * 30),
    bodyLimitBytes: Number(source.BODY_LIMIT_BYTES || 3 * 1024 * 1024)
  }
}

module.exports = { loadConfig }
