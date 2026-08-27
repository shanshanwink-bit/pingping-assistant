const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertEqualButtonFlex(source, containerSelector, itemSelector, gapPattern, filePath) {
  const escape = (selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const containerRule = new RegExp(`${escape(containerSelector)}\\s*\\{[^}]*display:\\s*flex`, 's')
  const itemRule = new RegExp(`${escape(itemSelector)}\\s*\\{[^}]*width:\\s*0[^}]*flex:\\s*1 1 0[^}]*box-sizing:\\s*border-box`, 's')

  assert.match(source, containerRule, `${filePath} 的 ${containerSelector} 应使用兼容小程序运行时的弹性布局`)
  assert.match(source, itemRule, `${filePath} 的双按钮应使用零基准等分并包含边框尺寸`)
  assert.match(source, gapPattern, `${filePath} 的双按钮应保留明确且稳定的间距`)
}

const detailStyles = read('pages/product-detail/index.wxss')
const transactionStyles = read('pages/purchase-form/index.wxss')
const aiPurchaseStyles = read('pages/ai-purchase/index.wxss')
const aiDraftStyles = read('pages/ai-purchase-draft/index.wxss')
const appStyles = read('app.wxss')

assert.match(detailStyles, /\.detail-action-bar\s*\{[^}]*display:\s*flex[^}]*left:\s*0[^}]*width:\s*100%[^}]*box-sizing:\s*border-box/s, '商品详情底部操作栏应严格占满视口且左右内边距一致')
assert.match(detailStyles, /\.sale-button\s*\{[^}]*width:\s*0[^}]*flex:\s*1 1 0[^}]*box-sizing:\s*border-box/s, '商品详情底部按钮应使用零基准等分，避免原生按钮宽度干扰')
assert.match(detailStyles, /\.sale-button\s*\{[^}]*margin-left:\s*18rpx/s, '商品详情左右按钮应保留明确且稳定的间距')
assertEqualButtonFlex(transactionStyles, '.success-actions', '.primary-action', /\.primary-action\s*\{[^}]*margin-left:\s*14rpx/s, 'pages/purchase-form/index.wxss')
assert.match(aiPurchaseStyles, /\.image-actions\s*\{[^}]*width:\s*100%[^}]*box-sizing:\s*border-box/s, '拍照入库图片按钮行应把内边距计入卡片宽度，避免右侧按钮溢出')
assert.match(aiPurchaseStyles, /\.image-action-slot\s*\{[^}]*width:\s*calc\(50%\s*-\s*9rpx\)[^}]*max-width:\s*calc\(50%\s*-\s*9rpx\)[^}]*flex:\s*0 0 calc\(50%\s*-\s*9rpx\)[^}]*overflow:\s*hidden/s, '拍照入库双按钮应使用明确的半宽槽位，避免原生按钮固有宽度撑开布局')
assert.match(aiPurchaseStyles, /\.image-action-slot\s*\+\s*\.image-action-slot\s*\{[^}]*margin-left:\s*18rpx/s, '拍照入库双按钮应保留 18rpx 独立间距')
assert.match(aiPurchaseStyles, /\.image-action\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*box-sizing:\s*border-box/s, '拍照入库原生按钮应被严格限制在各自等宽槽位内')
assertEqualButtonFlex(aiDraftStyles, '.success-actions', '.success-actions button', /\.success-actions button\s*\+\s*button\s*\{[^}]*margin-left:\s*18rpx/s, 'pages/ai-purchase-draft/index.wxss')
assertEqualButtonFlex(appStyles, '.button-row', '.button-row > button', /\.button-row\s*>\s*button\s*\+\s*button\s*\{[^}]*margin-left:\s*20rpx/s, 'app.wxss')

assert.doesNotMatch(
  detailStyles,
  /grid-template-columns:\s*1fr\s+1\.\d+fr/,
  '商品详情底部操作栏不应再次使用左右不等比例'
)

console.log('miniprogram button layout: PASS')
