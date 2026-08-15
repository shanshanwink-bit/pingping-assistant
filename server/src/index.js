const http = require('node:http')
const { loadConfig } = require('./config')
const { createPool } = require('./db')
const { createRequestHandler } = require('./app')

async function start() {
  const config = loadConfig(process.env)
  const pool = createPool(config.mysql)
  await pool.query('SELECT 1')

  const server = http.createServer(createRequestHandler(pool, {
    ...config,
    jwtSecret: process.env.JWT_SECRET
  }))

  server.listen(config.port, config.host, () => {
    console.log(`pingping-assistant-api listening on ${config.host}:${config.port}`)
  })

  async function shutdown(signal) {
    console.log(`received ${signal}, shutting down`)
    server.close(async () => {
      await pool.end()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch(error => {
  console.error('api startup failed', error.message)
  process.exit(1)
})
