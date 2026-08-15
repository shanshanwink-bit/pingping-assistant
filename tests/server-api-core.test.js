const assert = require('assert')
const { loadConfig } = require('../server/src/config')
const { signToken, verifyToken } = require('../server/src/token')
const { validState } = require('../server/src/app')

const secret = 'test-secret-that-is-longer-than-thirty-two-characters'
const config = loadConfig({
  PORT: '3000',
  MYSQL_DATABASE: 'pingping_test',
  MYSQL_USER: 'pingping_test',
  MYSQL_PASSWORD: 'password',
  JWT_SECRET: secret,
  ADMIN_ORIGINS: 'https://admin.example.com, https://ops.example.com'
})

assert.strictEqual(config.port, 3000)
assert.strictEqual(config.mysql.database, 'pingping_test')
assert.deepStrictEqual(config.adminOrigins, ['https://admin.example.com', 'https://ops.example.com'])

const token = signToken({ userId: 'u1', storeId: 's1', role: 'owner' }, secret, 60)
const payload = verifyToken(token, secret)
assert.strictEqual(payload.userId, 'u1')
assert.strictEqual(payload.storeId, 's1')
assert.strictEqual(payload.role, 'owner')

assert.strictEqual(validState({
  products: [], operations: [], purchases: [], sales: [], manualProfits: []
}), true)
assert.strictEqual(validState({ products: [] }), false)

assert.throws(() => loadConfig({
  MYSQL_DATABASE: 'x', MYSQL_USER: 'x', MYSQL_PASSWORD: 'x', JWT_SECRET: 'short'
}), /JWT_SECRET/)

console.log('self-hosted API core: PASS')
