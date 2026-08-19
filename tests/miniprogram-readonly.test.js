const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

const expectedTabs = [
  'pages/home/index',
  'pages/inventory/index',
  'pages/profit/index',
  'pages/profile/index'
]

const requiredActionPages = [
  'pages/cosmetics/index',
  'pages/product-form/index',
  'pages/ai-recognition/index',
  'pages/stock-form/index',
  'pages/purchase-form/index',
  'pages/sale-form/index',
  'pages/profit-form/index'
]

assert.deepStrictEqual(
  appConfig.tabBar.list.map(item => item.pagePath),
  expectedTabs,
  '小程序底部导航应保持首页、商品、账本、我的四个入口'
)

requiredActionPages.forEach(pagePath => {
  assert.strictEqual(
    appConfig.pages.includes(pagePath),
    true,
    `${pagePath} 应注册，保证首页高频经营操作可以正常进入`
  )
})

assert.strictEqual(
  appConfig.pages.includes('pages/quick-action/index'),
  false,
  '旧记一笔聚合页未被当前四栏导航和首页使用，不应重复注册'
)

const homeSource = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8')
const inventoryTemplate = fs.readFileSync(path.join(root, 'pages/inventory/index.wxml'), 'utf8')
const aiPageSource = fs.readFileSync(path.join(root, 'pages/ai-recognition/index.js'), 'utf8')
const businessMutationPattern = /store\.(?:addProduct|updateProduct|removeProduct|updateStock|addPurchase|addSale|addManualProfit|removeManualProfit)\s*\(/

assert.strictEqual(
  businessMutationPattern.test(homeSource),
  false,
  '首页只负责展示和导航，不应直接修改经营数据'
)

assert.match(inventoryTemplate, /wx:if="\{\{aiImageRecognition\}\}"/, 'AI 入口必须由公开 Feature API 状态控制')
assert.match(aiPageSource, /serverSync\.recognizeProductImage/, 'AI 页面必须通过 Node 接口识别，不得在小程序中调用模型')
assert.match(aiPageSource, /所选图片将用于商品识别，并通过第三方 AI 服务进行分析/, '首次使用必须说明第三方 AI 图片处理')

console.log('miniprogram home routes: PASS')
