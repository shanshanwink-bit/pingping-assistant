const crypto = require('node:crypto')

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function signature(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url')
}

function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode({ ...payload, iat: now, exp: now + ttlSeconds })
  const input = `${header}.${body}`
  return `${input}.${signature(input, secret)}`
}

function verifyToken(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('登录凭证格式不正确')
  const input = `${parts[0]}.${parts[1]}`
  const expected = Buffer.from(signature(input, secret))
  const actual = Buffer.from(parts[2])
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('登录凭证签名不正确')
  }
  const payload = decode(parts[1])
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('登录凭证已过期')
  return payload
}

module.exports = { signToken, verifyToken }
