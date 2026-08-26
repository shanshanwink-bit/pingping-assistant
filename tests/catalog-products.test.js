const assert = require('assert')
const { mergeCatalogProducts } = require('../utils/catalog-products')
const { absoluteImageUrl } = require('../utils/catalog-sync')
const { catalogProduct } = require('../server/src/app')

const apiProduct = catalogProduct({
  id: 6,
  name: '水200ml',
  code: '0002',
  item_number: ' HZ-200 ',
  business_type: '化妆品',
  category: '护肤',
  spec_count: 2,
  stock: 9,
  cost_price: '12.50',
  low_stock_threshold: 3,
  price: '29.90',
  status: '销售中',
  image_url: '/admin-api/v1/product-images/test.webp',
  updated_at: '2026-08-18 18:00:00'
})

assert.strictEqual(apiProduct.costPrice, 12.5)
assert.strictEqual(apiProduct.stock, 9)
assert.strictEqual(apiProduct.itemNumber, 'HZ-200')
assert.strictEqual(apiProduct.itemNumberManaged, false)
assert.strictEqual(apiProduct.status, '销售中')

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
assert.strictEqual(merged[0].itemNumber, 'HZ-200')
assert.strictEqual(merged[0].status, '销售中')
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

const legacyItemNumber = mergeCatalogProducts([{
  ...legacy,
  itemNumber: 'LOCAL-136',
  status: '缺货'
}], [{ ...apiProduct, itemNumber: '', status: undefined }])[0]
assert.strictEqual(legacyItemNumber.itemNumber, 'LOCAL-136', '后台新列为空时不应破坏旧 JSON 已有货号')
assert.strictEqual(legacyItemNumber.status, '缺货', '缺货状态应兼容为启用状态并原样保存')

const explicitlyCleared = mergeCatalogProducts([{
  ...legacy,
  itemNumber: 'WRONG-136'
}], [{ ...apiProduct, itemNumber: '', itemNumberManaged: true }])[0]
assert.strictEqual(explicitlyCleared.itemNumber, '', '用户显式清空后必须清除旧 JSON 货号')
assert.strictEqual(explicitlyCleared.code, '0002', '清空货号不得改变内部流水号')

const legacyWithoutFields = mergeCatalogProducts([], [{
  ...apiProduct,
  id: 8,
  code: '0008',
  itemNumber: undefined,
  status: undefined
}])[0]
assert.strictEqual(legacyWithoutFields.itemNumber, '', '老商品没有货号时不得从 code 伪造')
assert.strictEqual(legacyWithoutFields.status, '销售中', '老 JSON 缺少 status 时按启用处理')
assert.strictEqual(legacyWithoutFields.code, '0008')

const formalOrigin = 'https://shanshanwink.online/pingping-api/v1'
assert.strictEqual(
  absoluteImageUrl('/admin-api/v1/product-images/example.jpg', formalOrigin),
  'https://shanshanwink.online/pingping-admin-api/v1/product-images/example.jpg'
)
assert.strictEqual(
  absoluteImageUrl('http://106.13.176.125/admin-api/v1/product-images/example.jpg', formalOrigin),
  'https://shanshanwink.online/pingping-admin-api/v1/product-images/example.jpg'
)

console.log('admin catalog product sync: PASS')
