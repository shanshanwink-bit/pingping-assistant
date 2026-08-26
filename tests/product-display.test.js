const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildListProduct,
  buildProductDetail,
  filterProducts,
  formatMoney,
  productDetailUrl,
  stockPresentation
} = require('../utils/product-display')

const products = [
  { id: 'coat', name: '白色针织开衫', code: '0001', itemNumber: 'A1023', businessType: 'clothing' },
  { id: 'water', name: '水100ml', code: '0002', businessType: 'cosmetics' }
]

test('商品名称搜索', () => {
  assert.deepEqual(filterProducts(products, { keyword: ' 针织 ', businessType: 'all' }).map(item => item.id), ['coat'])
})

test('普通商品搜索只使用名称和真实货号', () => {
  assert.equal(filterProducts(products, { keyword: 'a1023', businessType: 'all' })[0].id, 'coat')
  assert.equal(filterProducts(products, { keyword: '0002', businessType: 'all' }).length, 0)
})

test('货号为空时不把内部流水号回退显示成货号', () => {
  const listItem = buildListProduct(products[1])
  const detail = buildProductDetail({ ...products[1], specs: [] })
  assert.equal(listItem.identifier, '')
  assert.equal(detail.identifier, '')
  assert.equal(Object.hasOwn(listItem, 'code'), false)
  assert.equal(Object.hasOwn(detail, 'code'), false)
})

test('商品类型分类筛选使用真实字段', () => {
  assert.deepEqual(filterProducts(products, { businessType: 'cosmetics' }).map(item => item.id), ['water'])
})

test('空搜索恢复全部商品', () => {
  assert.equal(filterProducts(products, { keyword: '   ', businessType: 'all' }).length, 2)
})

test('库存为零显示已缺货', () => {
  assert.equal(stockPresentation({ totalStock: 0, specs: [] }).label, '已缺货')
})

test('复用规格阈值判断低库存', () => {
  assert.equal(stockPresentation({ totalStock: 3, lowStockThreshold: 1, specs: [{ stock: 1 }, { stock: 2 }] }).label, '库存偏低')
})

test('正常库存状态', () => {
  assert.equal(stockPresentation({ totalStock: 8, lowStockThreshold: 1, specs: [{ stock: 4 }, { stock: 4 }] }).label, '库存正常')
})

test('真实售价格式化为两位小数', () => {
  assert.equal(formatMoney(129), '¥129.00')
  const detail = buildProductDetail({ salePrice: 68, costPrice: 68, specs: [] })
  assert.equal(detail.marginText, '¥0.00')
  assert.equal(buildProductDetail({ salePrice: 60, costPrice: 68, specs: [] }).marginText, '-¥8.00')
})

test('缺失或零价格不产生假 ¥0.00', () => {
  assert.equal(formatMoney(undefined), '')
  assert.equal(formatMoney(0), '')
})

test('完整服装颜色尺码规格生成库存矩阵', () => {
  const detail = buildProductDetail({
    id: 'c1', name: '针织衫', businessType: 'clothing', lowStockThreshold: 1,
    specs: [
      { id: '1', color: '白色', size: 'M', stock: 2 },
      { id: '2', color: '白色', size: 'L', stock: 0 },
      { id: '3', color: '黑色', size: 'M', stock: 4 }
    ]
  })
  assert.equal(detail.specDisplayMode, 'matrix')
  assert.deepEqual(detail.matrix.sizes, ['M', 'L'])
  assert.equal(detail.matrix.rows[0].cells[1].tone, 'danger')
})

test('化妆品临期状态复用首页 30 天规则', () => {
  const detail = buildProductDetail({ id: 'x', name: '粉水', businessType: 'cosmetics', expiryDate: '2026-09-05', specs: [] }, { now: new Date(2026, 7, 18, 10) })
  assert.equal(detail.cosmetics.expiry.label, '距离到期还有 18 天')
})

test('化妆品过期状态', () => {
  const detail = buildProductDetail({ id: 'x', name: '面霜', businessType: 'cosmetics', expiryDate: '2026-08-17', specs: [] }, { now: new Date(2026, 7, 18, 10) })
  assert.equal(detail.cosmetics.expiry.label, '已过期')
})

test('缺失字段不产生 undefined 或 NaN', () => {
  const output = JSON.stringify(buildProductDetail({ id: 'old', specs: [{ stock: undefined }] }))
  assert.equal(output.includes('undefined'), false)
  assert.equal(output.includes('NaN'), false)
})

test('商品详情路由参数安全编码', () => {
  assert.equal(productDetailUrl('商品 1/2'), '/pages/product-detail/index?id=%E5%95%86%E5%93%81%201%2F2')
})

test('停用商品详情保留可见状态但标记为不可交易', () => {
  const inactive = buildProductDetail({ id: 'old', name: '历史商品', status: '已停用', specs: [] })
  assert.equal(inactive.status, '已停用')
  assert.equal(inactive.isActive, false)
  const legacy = buildProductDetail({ id: 'legacy', name: '历史缺货商品', status: '缺货', specs: [] })
  assert.equal(legacy.isActive, true)
})
