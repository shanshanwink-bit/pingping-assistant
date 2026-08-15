const assert = require('assert')

const storage = {}
global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key) { delete storage[key] }
}

const store = require('../utils/store')
const storageKey = 'clothing_inventory_state_v2'

storage[storageKey] = {
  version: 5,
  currentUser: { id: 'u1', name: '店主', role: 'owner' },
  products: [{
    id: 'legacy', code: 'SY-0001', name: '旧服装', category: '上衣', costPrice: 0,
    salePrice: 0, supplier: '', location: '', lowStockThreshold: 0, specs: []
  }],
  operations: [], purchases: [], sales: [], manualProfits: [{ id: 'legacy-profit', date: '2026-08-01', amount: 10, createdAt: '2026-08-01 10:00' }]
}
store.ensureState()
assert.strictEqual(storage[storageKey].version, 10)
assert.strictEqual(storage[storageKey].products[0].code, '0001')
assert.strictEqual(storage[storageKey].products[0].itemNumber, '')
assert.strictEqual(storage[storageKey].nextProductNumber, 2)
assert.deepStrictEqual(storage[storageKey].suppliers, [])
assert.deepStrictEqual(storage[storageKey].brands, [])
assert.strictEqual(storage[storageKey].products[0].businessType, 'clothing')
assert.strictEqual(storage[storageKey].manualProfits[0].businessType, 'clothing')
assert.strictEqual(storage[storageKey].manualProfits[0].entryType, 'income')

storage[storageKey] = {
  version: 10,
  currentUser: { id: 'u1', name: '店主', role: 'owner' },
  products: [], nextProductNumber: 1, operations: [], purchases: [], sales: [], manualProfits: []
}

const clothing = store.addProduct({
  businessType: 'clothing', name: '针织衫', category: '上衣', itemNumber: 'A-136', image: '', costPrice: 20,
  salePrice: 50, supplier: '', location: '', lowStockThreshold: 1,
  specs: [{ color: '黑色', size: 'M', stock: 3 }]
})
const cosmetic = store.addProduct({
  businessType: 'cosmetics', name: '精华液', category: '护肤', image: '', costPrice: 40,
  salePrice: 99, supplier: '', brand: '测试品牌', batchNumber: 'B202608', expiryDate: '2028-08-09',
  location: '', lowStockThreshold: 1,
  specs: [{ color: '透明', size: '30ml', stock: 5 }]
})
assert.strictEqual(clothing.code, '0001')
assert.strictEqual(cosmetic.code, '0002')
assert.strictEqual(clothing.itemNumber, 'A-136')

const editedClothing = store.updateProduct(clothing.id, {
  name: '针织衫升级款', category: '上衣', itemNumber: 'A-136', image: '/images/knit.png', costPrice: 20,
  salePrice: 50, supplier: '测试供应商', location: 'A-01', lowStockThreshold: 1,
  specs: [
    { id: clothing.specs[0].id, color: '黑色', size: 'M', stock: 3 },
    { color: '黑色', size: 'L', stock: 2 }
  ]
})
assert.strictEqual(editedClothing.name, '针织衫升级款')
assert.strictEqual(editedClothing.image, '/images/knit.png')
assert.strictEqual(editedClothing.specs.length, 2)
assert.strictEqual(editedClothing.specs[0].id, clothing.specs[0].id)
assert.deepStrictEqual(store.getSuppliers(), ['测试供应商'])

assert.deepStrictEqual(store.getProducts('clothing').map(item => item.name), ['针织衫升级款'])
assert.deepStrictEqual(store.getProducts('cosmetics').map(item => item.name), ['精华液'])
assert.strictEqual(store.getProduct(cosmetic.id).brand, '测试品牌')
assert.deepStrictEqual(store.getBrands(), ['测试品牌'])
assert.strictEqual(store.getProduct(cosmetic.id).expiryDate, '2028-08-09')
assert.strictEqual(store.getState().operations.filter(item => item.businessType === 'cosmetics' && item.type === 'stocktake').length, 1)

store.addPurchase({ productId: clothing.id, specId: clothing.specs[0].id, quantity: 2, unitCost: 20 })
store.addSale({ productId: cosmetic.id, specId: cosmetic.specs[0].id, quantity: 1, unitPrice: 99 })

const clothingSummary = store.getSummary('clothing')
const cosmeticSummary = store.getSummary('cosmetics')
assert.strictEqual(clothingSummary.totalStock, 7)
assert.strictEqual(clothingSummary.todayPurchaseQuantity, 2)
assert.strictEqual(clothingSummary.todaySaleQuantity, 0)
assert.strictEqual(cosmeticSummary.totalStock, 4)
assert.strictEqual(cosmeticSummary.todayPurchaseQuantity, 0)
assert.strictEqual(cosmeticSummary.todaySaleQuantity, 1)
assert.strictEqual(store.getPurchaseRecords('clothing').length, 1)
assert.strictEqual(store.getPurchaseRecords('cosmetics').length, 0)
assert.strictEqual(store.getSaleRecords('clothing').length, 0)
assert.strictEqual(store.getSaleRecords('cosmetics').length, 1)

store.addSale({ productId: clothing.id, specId: clothing.specs[0].id, quantity: 1, unitPrice: 50 })
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
store.addManualProfit({ businessType: 'clothing', date: today, amount: 10, note: '服装补录' })
store.addManualProfit({ businessType: 'cosmetics', date: today, amount: 20, note: '化妆品补录' })
const clothingProfit = store.getProfitAnalysis({ businessType: 'clothing', period: 'today' })
const cosmeticProfit = store.getProfitAnalysis({ businessType: 'cosmetics', period: 'today' })
assert.strictEqual(clothingProfit.summary.revenue, 50)
assert.strictEqual(clothingProfit.summary.profit, 40)
assert.strictEqual(cosmeticProfit.summary.revenue, 99)
assert.strictEqual(cosmeticProfit.summary.profit, 79)
assert.strictEqual(store.getManualProfitRecords('clothing').length, 1)
assert.strictEqual(store.getManualProfitRecords('cosmetics').length, 1)
const expenseRecord = store.addManualProfit({ businessType: 'cosmetics', entryType: 'expense', date: today, amount: -5, note: '运费' })
assert.strictEqual(expenseRecord.entryType, 'expense')
assert.strictEqual(expenseRecord.amount, -5)
store.removeManualProfit(expenseRecord.id)

store.updateStock({
  type: 'stocktake', productId: cosmetic.id, specId: cosmetic.specs[0].id,
  quantity: 8, reason: '库存增加'
})
assert.strictEqual(store.getSummary('cosmetics').totalStock, 8)
assert.strictEqual(store.getState().operations.filter(item => item.businessType === 'cosmetics' && item.type === 'stocktake').length, 2)

const laterCosmetic = store.addProduct({
  businessType: 'cosmetics', name: '口红', category: '彩妆', image: '', costPrice: 20,
  salePrice: 50, supplier: '', brand: '', batchNumber: '', expiryDate: '',
  location: '', lowStockThreshold: 1,
  specs: [{ color: '正红', size: '标准规格', stock: 0 }]
})
assert.strictEqual(laterCosmetic.code, '0003')
store.removeProduct(cosmetic.id)
assert.strictEqual(store.getProduct(clothing.id).code, '0001')
assert.strictEqual(store.getProduct(laterCosmetic.id).code, '0002')
const replacementCosmetic = store.addProduct({
  businessType: 'cosmetics', name: '面霜', category: '护肤', image: '', costPrice: 30,
  salePrice: 80, supplier: '', brand: '', batchNumber: '', expiryDate: '',
  location: '', lowStockThreshold: 1,
  specs: [{ color: '通用', size: '50ml', stock: 2 }]
})
assert.strictEqual(replacementCosmetic.code, '0003')
store.removeProduct(laterCosmetic.id)
store.removeProduct(replacementCosmetic.id)
assert.strictEqual(store.getProducts('cosmetics').length, 0)
assert.strictEqual(store.getSaleRecords('cosmetics').length, 1)
assert.strictEqual(store.getSummary().recentOperations.some(item => item.productId === cosmetic.id), false)
assert.strictEqual(store.getSummary('cosmetics').recentOperations.length, 0)

console.log('business type inventory isolation: PASS')
