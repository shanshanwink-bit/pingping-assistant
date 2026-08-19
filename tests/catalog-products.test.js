const assert = require('assert')
const { mergeCatalogProducts } = require('../utils/catalog-products')
const { catalogProduct } = require('../server/src/app')

const apiProduct = catalogProduct({
  id: 6,
  name: '水200ml',
  code: '0002',
  business_type: '化妆品',
  category: '护肤',
  spec_count: 2,
  stock: 9,
  cost_price: '12.50',
  low_stock_threshold: 3,
  price: '29.90',
  image_url: '/admin-api/v1/product-images/test.webp',
  updated_at: '2026-08-18 18:00:00'
})

assert.strictEqual(apiProduct.costPrice, 12.5)
assert.strictEqual(apiProduct.stock, 9)

const legacy = {
  id: 'legacy-1', code: '0002', name: '旧名称', businessType: 'cosmetics', category: '护肤',
  specs: [
    { id: 'spec-a', color: '蓝色', size: '100ml', stock: 3 },
    { id: 'spec-b', color: '粉色', size: '100ml', stock: 2 }
  ]
}
const localOnly = {
  id: 'local-only', code: '0099', name: '本地历史商品', businessType: 'clothing', category: '其他',
  specs: [{ id: 'local-spec', color: '默认', size: '均码', stock: 1 }]
}

const merged = mergeCatalogProducts([legacy, localOnly], [apiProduct])
assert.strictEqual(merged.length, 2)
assert.strictEqual(merged[0].id, 'legacy-1', '按编号接管历史商品时应保留本地 ID 和流水关联')
assert.strictEqual(merged[0].adminProductId, 6)
assert.strictEqual(merged[0].name, '水200ml')
assert.strictEqual(merged[0].businessType, 'cosmetics')
assert.strictEqual(merged[0].specCount, 2)
assert.strictEqual(merged[0].specs.reduce((sum, item) => sum + item.stock, 0), 9)
assert.strictEqual(merged[1].id, 'local-only', '尚未被后台接管的历史商品不应丢失')

const refreshed = mergeCatalogProducts(merged, [])
assert.deepStrictEqual(refreshed.map(item => item.id), ['local-only'], '后台删除的商品应从小程序缓存移除')

const created = mergeCatalogProducts([], [{ ...apiProduct, id: 7, code: '0003', stock: 4 }])[0]
assert.strictEqual(created.id, 'admin-product-7')
assert.strictEqual(created.specs[0].stock, 4)
assert.strictEqual(created.totalStock, undefined)

console.log('admin catalog product sync: PASS')
