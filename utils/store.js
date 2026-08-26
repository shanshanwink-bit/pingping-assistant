const STORAGE_KEY = 'clothing_inventory_state_v2'
const LEGACY_STORAGE_KEYS = ['clothing_inventory_state_v1']
const serverSync = require('./server-sync')
const { mergeCatalogProducts } = require('./catalog-products')
const { summarizeProfitRecords } = require('./ledger')
const { isProductActiveStatus, normalizeProductStatus } = require('./product-status')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function nowText() {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function createSeedState() {
  return {
    version: 10,
    currentUser: { id: 'u1', name: '店主', role: 'owner' },
    products: [],
    nextProductNumber: 1,
    suppliers: [],
    brands: [],
    operations: [],
    purchases: [],
    sales: [],
    manualProfits: []
  }
}

function migrateProductCodes(products) {
  const ordered = products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const timeCompare = String(a.product.createdAt || '').localeCompare(String(b.product.createdAt || ''))
      return timeCompare || b.index - a.index
    })
  ordered.forEach((entry, index) => {
    entry.product.code = String(index + 1).padStart(4, '0')
    if (entry.product.itemNumber === undefined) entry.product.itemNumber = ''
  })
  return ordered.length + 1
}

function nextNumberFromProducts(products) {
  const numbers = products
    .map(item => /^\d+$/.test(String(item.code || '')) ? Number(item.code) : 0)
  return (numbers.length ? Math.max(...numbers) : 0) + 1
}

function compactProductCodes(products) {
  products
    .slice()
    .sort((a, b) => {
      const codeCompare = Number(a.code || 0) - Number(b.code || 0)
      return codeCompare || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    })
    .forEach((product, index) => {
      product.code = String(index + 1).padStart(4, '0')
    })
}

function ensureState() {
  LEGACY_STORAGE_KEYS.forEach(key => wx.removeStorageSync(key))
  let state = wx.getStorageSync(STORAGE_KEY)
  if (!state || !Array.isArray(state.products) || !Array.isArray(state.operations)) {
    state = createSeedState()
    wx.setStorageSync(STORAGE_KEY, state)
  } else {
    let migrated = false
    if (!Array.isArray(state.purchases)) {
      state.purchases = []
      migrated = true
    }
    if (!Array.isArray(state.sales)) {
      state.sales = []
      migrated = true
    }
    if (!Array.isArray(state.manualProfits)) {
      state.manualProfits = []
      migrated = true
    }
    if (!Array.isArray(state.suppliers)) {
      state.suppliers = state.products
        .map(product => String(product.supplier || '').trim())
        .filter((supplier, index, list) => supplier && list.indexOf(supplier) === index)
      migrated = true
    }
    if (!Array.isArray(state.brands)) {
      state.brands = state.products
        .map(product => String(product.brand || '').trim())
        .filter((brand, index, list) => brand && list.indexOf(brand) === index)
      migrated = true
    }
    state.products.forEach(product => {
      if (!product.businessType) {
        product.businessType = 'clothing'
        migrated = true
      }
      if (product.itemNumber === undefined) {
        product.itemNumber = ''
        migrated = true
      }
      if (!product.status) {
        product.status = normalizeProductStatus(product.status)
        migrated = true
      }
    })
    state.manualProfits.forEach(record => {
      if (!record.businessType) {
        record.businessType = 'clothing'
        migrated = true
      }
      if (!record.entryType) {
        record.entryType = Number(record.amount || 0) < 0 ? 'expense' : 'income'
        migrated = true
      }
    })
    if (state.version !== 10) {
      state.nextProductNumber = migrateProductCodes(state.products)
      state.version = 10
      migrated = true
    }
    if (!Number.isInteger(state.nextProductNumber) || state.nextProductNumber < 1) {
      state.nextProductNumber = nextNumberFromProducts(state.products)
      migrated = true
    }
    if (migrated) wx.setStorageSync(STORAGE_KEY, state)
  }
  return state
}

function getState() {
  return clone(ensureState())
}

function setCurrentUser(user) {
  const state = ensureState()
  state.currentUser = {
    id: user.id,
    name: user.name || '店主',
    account: user.account || '',
    role: user.role || 'owner'
  }
  saveState(state)
  return clone(state.currentUser)
}

function replaceStateFromServer(serverState, user) {
  if (!serverState || !Array.isArray(serverState.products) || !Array.isArray(serverState.operations)) {
    throw new Error('服务器库存数据格式不正确')
  }
  const state = clone(serverState)
  if (state.version !== 10) state.nextProductNumber = migrateProductCodes(state.products)
  state.version = 10
  state.products.forEach(product => {
    if (product.itemNumber === undefined) product.itemNumber = ''
    if (!product.status) product.status = normalizeProductStatus(product.status)
  })
  if (!Number.isInteger(state.nextProductNumber) || state.nextProductNumber < 1) {
    state.nextProductNumber = nextNumberFromProducts(state.products)
  }
  state.purchases = Array.isArray(state.purchases) ? state.purchases : []
  state.sales = Array.isArray(state.sales) ? state.sales : []
  state.manualProfits = Array.isArray(state.manualProfits) ? state.manualProfits : []
  state.manualProfits.forEach(record => {
    if (!record.entryType) record.entryType = Number(record.amount || 0) < 0 ? 'expense' : 'income'
  })
  state.suppliers = Array.isArray(state.suppliers)
    ? state.suppliers
    : state.products
      .map(product => String(product.supplier || '').trim())
      .filter((supplier, index, list) => supplier && list.indexOf(supplier) === index)
  state.brands = Array.isArray(state.brands)
    ? state.brands
    : state.products
      .map(product => String(product.brand || '').trim())
      .filter((brand, index, list) => brand && list.indexOf(brand) === index)
  state.currentUser = {
    id: user.id,
    name: user.name || '微信店主',
    account: user.openid || user.account || '',
    role: 'owner'
  }
  wx.setStorageSync(STORAGE_KEY, state)
  return clone(state)
}

function replaceProductsFromCatalog(items) {
  const state = ensureState()
  state.products = mergeCatalogProducts(state.products, items)
  state.nextProductNumber = nextNumberFromProducts(state.products)
  wx.setStorageSync(STORAGE_KEY, state)
  return clone(state.products)
}

function saveState(state) {
  wx.setStorageSync(STORAGE_KEY, state)
  serverSync.queuePush(state)
  return clone(state)
}

function productStock(product) {
  return product.specs.reduce((sum, spec) => sum + Number(spec.stock || 0), 0)
}

function withStock(product) {
  return { ...product, totalStock: productStock(product) }
}

function productBusinessType(product) {
  return product.businessType || 'clothing'
}

function getProducts(businessType) {
  return getState().products
    .filter(product => isProductActiveStatus(product.status))
    .filter(product => !businessType || productBusinessType(product) === businessType)
    .map(withStock)
}

function getAllProducts(businessType) {
  return getState().products
    .filter(product => !businessType || productBusinessType(product) === businessType)
    .map(withStock)
}

function getProduct(id) {
  const product = getState().products.find(item => item.id === id)
  return product ? withStock(product) : null
}

function getSuppliers() {
  return getState().suppliers.slice()
}

function getBrands() {
  return getState().brands.slice()
}

function rememberSupplier(state, value) {
  const supplier = String(value || '').trim()
  if (!supplier) return
  const existingIndex = state.suppliers.findIndex(item => String(item).toLowerCase() === supplier.toLowerCase())
  if (existingIndex >= 0) state.suppliers.splice(existingIndex, 1)
  state.suppliers.unshift(supplier)
}

function rememberBrand(state, value) {
  const brand = String(value || '').trim()
  if (!brand) return
  const existingIndex = state.brands.findIndex(item => String(item).toLowerCase() === brand.toLowerCase())
  if (existingIndex >= 0) state.brands.splice(existingIndex, 1)
  state.brands.unshift(brand)
}

function recordBusinessType(record, products) {
  if (record.businessType) return record.businessType
  const product = products.find(item => item.id === record.productId)
  return product ? productBusinessType(product) : 'clothing'
}

function getPurchaseRecords(businessType) {
  const state = getState()
  return state.purchases.filter(item => !businessType || recordBusinessType(item, state.products) === businessType)
}

function getSaleRecords(businessType) {
  const state = getState()
  return state.sales.filter(item => !businessType || recordBusinessType(item, state.products) === businessType)
}

function getManualProfitRecords(businessType) {
  return getState().manualProfits.filter(item => !businessType || (item.businessType || 'clothing') === businessType)
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function uniqueId(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`
}

function getSummary(businessType) {
  const state = getState()
  const products = state.products.filter(product => !businessType || productBusinessType(product) === businessType)
  const existingProductIds = state.products.map(product => product.id)
  const purchases = state.purchases.filter(item => !businessType || recordBusinessType(item, state.products) === businessType)
  const sales = state.sales.filter(item => !businessType || recordBusinessType(item, state.products) === businessType)
  const operations = state.operations.filter(item => (
    existingProductIds.includes(item.productId) &&
    (!businessType || recordBusinessType(item, state.products) === businessType)
  ))
  const totalStock = products.reduce((sum, product) => sum + productStock(product), 0)
  const stockValue = products.reduce((sum, product) => sum + productStock(product) * Number(product.costPrice || 0), 0)
  const categoryMap = {}
  products.forEach(product => {
    categoryMap[product.category] = (categoryMap[product.category] || 0) + productStock(product)
  })
  const categoryStats = Object.keys(categoryMap)
    .map(category => ({
      category,
      stock: categoryMap[category],
      percent: totalStock ? Math.max(5, Math.round(categoryMap[category] / totalStock * 100)) : 0
    }))
    .sort((a, b) => b.stock - a.stock)
  const today = nowText().slice(0, 10)
  const todayPurchases = purchases.filter(item => item.createdAt.slice(0, 10) === today)
  const todaySales = sales.filter(item => item.createdAt.slice(0, 10) === today)
  const todayPurchaseQuantity = todayPurchases.reduce((sum, item) => sum + item.quantity, 0)
  const todayPurchaseAmount = roundMoney(todayPurchases.reduce((sum, item) => sum + item.totalCost, 0))
  const todaySaleQuantity = todaySales.reduce((sum, item) => sum + item.quantity, 0)
  const todaySaleAmount = roundMoney(todaySales.reduce((sum, item) => sum + item.totalAmount, 0))
  const lowSpecs = []
  products.forEach(product => {
    product.specs.forEach(spec => {
      if (spec.stock <= product.lowStockThreshold) {
        lowSpecs.push({
          specId: spec.id,
          productId: product.id,
          productName: product.name,
          code: product.code,
          specText: `${spec.color} / ${spec.size}`,
          stock: spec.stock,
          threshold: product.lowStockThreshold
        })
      }
    })
  })
  return {
    totalStock,
    stockValue,
    productCount: products.length,
    categoryStats,
    todayInbound: todayPurchaseQuantity,
    todayOutbound: todaySaleQuantity,
    todayPurchaseQuantity,
    todayPurchaseAmount,
    todaySaleQuantity,
    todaySaleAmount,
    lowSpecs,
    outOfStockCount: lowSpecs.filter(item => item.stock === 0).length,
    recentOperations: operations.slice(0, 5)
  }
}

function takeNextCode(state) {
  const usedNumbers = new Set(
    state.products
      .map(item => /^\d+$/.test(String(item.code || '')) ? Number(item.code) : 0)
      .filter(number => number > 0)
  )
  let next = 1
  while (usedNumbers.has(next)) next += 1
  state.nextProductNumber = next + 1
  return String(next).padStart(4, '0')
}

function addProduct(payload) {
  const state = getState()
  const id = uniqueId('p')
  const product = {
    id,
    code: takeNextCode(state),
    itemNumber: String(payload.itemNumber || '').trim(),
    status: '销售中',
    name: payload.name.trim(),
    businessType: payload.businessType === 'cosmetics' ? 'cosmetics' : 'clothing',
    category: payload.category,
    image: payload.image || '',
    costPrice: Number(payload.costPrice || 0),
    salePrice: Number(payload.salePrice || 0),
    supplier: String(payload.supplier || '').trim(),
    brand: String(payload.brand || '').trim(),
    batchNumber: String(payload.batchNumber || '').trim(),
    expiryDate: String(payload.expiryDate || '').trim(),
    location: String(payload.location || '').trim(),
    lowStockThreshold: Number(payload.lowStockThreshold || 0),
    createdAt: nowText(),
    specs: payload.specs.map((spec, index) => ({
      id: `${id}s${index + 1}`,
      color: spec.color,
      size: spec.size,
      stock: Number(spec.stock || 0)
    }))
  }
  state.products.unshift(product)
  rememberSupplier(state, product.supplier)
  rememberBrand(state, product.brand)
  if (product.businessType === 'cosmetics') {
    product.specs.forEach(spec => {
      state.operations.unshift({
        id: uniqueId('o'),
        type: 'stocktake',
        productId: product.id,
        productName: product.name,
        businessType: product.businessType,
        specId: spec.id,
        specText: `${spec.color} / ${spec.size}`,
        quantity: Number(spec.stock || 0),
        before: 0,
        after: Number(spec.stock || 0),
        reason: '新建商品库存',
        operator: state.currentUser.name,
        createdAt: product.createdAt
      })
    })
  }
  saveState(state)
  return withStock(product)
}

function removeProduct(id) {
  const state = getState()
  const index = state.products.findIndex(item => item.id === id)
  if (index < 0) throw new Error('商品不存在')
  const removed = state.products.splice(index, 1)[0]
  compactProductCodes(state.products)
  state.nextProductNumber = state.products.length + 1
  saveState(state)
  return withStock(removed)
}

function updateProduct(id, payload) {
  const state = getState()
  const product = state.products.find(item => item.id === id)
  if (!product) throw new Error('商品不存在')
  const previousSpecs = product.specs.slice()
  const previousByKey = {}
  previousSpecs.forEach(spec => { previousByKey[`${spec.color}__${spec.size}`] = spec })
  const createdAt = nowText()
  const specs = payload.specs.map((spec, index) => {
    const previous = previousSpecs.find(item => item.id === spec.id) || previousByKey[`${spec.color}__${spec.size}`]
    return {
      id: previous ? previous.id : `${id}s${Date.now()}${index + 1}`,
      color: spec.color,
      size: spec.size,
      stock: Number(spec.stock || 0)
    }
  })

  specs.forEach(spec => {
    const previous = previousSpecs.find(item => item.id === spec.id)
    const before = previous ? Number(previous.stock || 0) : 0
    const after = Number(spec.stock || 0)
    if (before === after) return
    state.operations.unshift({
      id: uniqueId('o'),
      type: 'stocktake',
      productId: product.id,
      productName: String(payload.name || product.name).trim(),
      businessType: productBusinessType(product),
      specId: spec.id,
      specText: `${spec.color} / ${spec.size}`,
      quantity: after - before,
      before,
      after,
      reason: '编辑商品库存',
      operator: state.currentUser.name,
      createdAt
    })
  })

  previousSpecs.forEach(spec => {
    if (specs.some(item => item.id === spec.id) || Number(spec.stock || 0) === 0) return
    state.operations.unshift({
      id: uniqueId('o'),
      type: 'stocktake',
      productId: product.id,
      productName: String(payload.name || product.name).trim(),
      businessType: productBusinessType(product),
      specId: spec.id,
      specText: `${spec.color} / ${spec.size}`,
      quantity: -Number(spec.stock || 0),
      before: Number(spec.stock || 0),
      after: 0,
      reason: '删除商品规格',
      operator: state.currentUser.name,
      createdAt
    })
  })

  Object.assign(product, {
    name: String(payload.name || '').trim(),
    category: payload.category,
    itemNumber: String(payload.itemNumber || '').trim(),
    image: payload.image || '',
    costPrice: Number(payload.costPrice || 0),
    salePrice: Number(payload.salePrice || 0),
    supplier: String(payload.supplier || '').trim(),
    brand: String(payload.brand || '').trim(),
    batchNumber: String(payload.batchNumber || '').trim(),
    expiryDate: String(payload.expiryDate || '').trim(),
    location: String(payload.location || '').trim(),
    lowStockThreshold: Number(payload.lowStockThreshold || 0),
    updatedAt: createdAt,
    specs
  })
  rememberSupplier(state, product.supplier)
  rememberBrand(state, product.brand)
  saveState(state)
  return withStock(product)
}

function findProductAndSpec(state, productId, specId) {
  const product = state.products.find(item => item.id === productId)
  if (!product) throw new Error('商品不存在')
  if (!isProductActiveStatus(product.status)) throw new Error('商品已停用，请先重新启用')
  const spec = product.specs.find(item => item.id === specId)
  if (!spec) throw new Error('商品规格不存在')
  return { product, spec }
}

function addPurchase(payload) {
  const state = getState()
  const { product, spec } = findProductAndSpec(state, payload.productId, payload.specId)
  const quantity = Number(payload.quantity)
  const unitCost = roundMoney(payload.unitCost)
  if (quantity <= 0) throw new Error('进货数量必须大于 0')
  if (unitCost <= 0) throw new Error('单件拿货价必须大于 0')

  const before = Number(spec.stock || 0)
  const productStockBefore = productStock(product)
  const after = before + quantity
  const previousCost = Number(product.costPrice || 0)
  if (unitCost > 0) product.costPrice = roundMoney((productStockBefore * previousCost + quantity * unitCost) / (productStockBefore + quantity))
  if (String(payload.supplier || '').trim()) product.supplier = String(payload.supplier).trim()
  spec.stock = after

  const record = {
    id: uniqueId('pu'),
    productId: product.id,
    productName: product.name,
    businessType: productBusinessType(product),
    specId: spec.id,
    specText: `${spec.color} / ${spec.size}`,
    quantity,
    unitCost,
    totalCost: roundMoney(quantity * unitCost),
    supplier: String(payload.supplier || '').trim(),
    note: String(payload.note || '').trim(),
    operator: state.currentUser.name,
    createdAt: nowText()
  }
  const operation = {
    id: uniqueId('op'), type: 'inbound', productId: product.id, productName: product.name, businessType: productBusinessType(product), specId: spec.id,
    specText: record.specText, quantity, before, after, reason: '进货入库', operator: state.currentUser.name, createdAt: record.createdAt
  }
  state.purchases.unshift(record)
  state.operations.unshift(operation)
  saveState(state)
  return record
}

function addSale(payload) {
  const state = getState()
  const { product, spec } = findProductAndSpec(state, payload.productId, payload.specId)
  const quantity = Number(payload.quantity)
  const unitPrice = roundMoney(payload.unitPrice)
  if (quantity <= 0) throw new Error('售出数量必须大于 0')
  if (unitPrice < 0) throw new Error('售价不能小于 0')

  const before = Number(spec.stock || 0)
  if (quantity > before) throw new Error(`库存不足，当前仅剩 ${before} 件`)
  const after = before - quantity
  spec.stock = after
  if (unitPrice > 0) product.salePrice = unitPrice
  const hasCost = Number(product.costPrice || 0) > 0
  const unitCost = hasCost ? roundMoney(product.costPrice) : null
  const totalAmount = roundMoney(quantity * unitPrice)
  const totalCost = hasCost ? roundMoney(quantity * unitCost) : null
  const grossProfit = hasCost ? roundMoney(totalAmount - totalCost) : null

  const record = {
    id: uniqueId('sa'),
    productId: product.id,
    productName: product.name,
    businessType: productBusinessType(product),
    specId: spec.id,
    specText: `${spec.color} / ${spec.size}`,
    quantity,
    unitPrice,
    unitCost,
    totalAmount,
    totalCost,
    grossProfit,
    grossMargin: hasCost && totalAmount ? roundMoney(grossProfit / totalAmount * 100) : null,
    paymentMethod: payload.paymentMethod || '未记录',
    note: String(payload.note || '').trim(),
    operator: state.currentUser.name,
    createdAt: nowText()
  }
  const operation = {
    id: uniqueId('os'), type: 'outbound', productId: product.id, productName: product.name, businessType: productBusinessType(product), specId: spec.id,
    specText: record.specText, quantity: -quantity, before, after, reason: '商品卖出', operator: state.currentUser.name, createdAt: record.createdAt
  }
  state.sales.unshift(record)
  state.operations.unshift(operation)
  saveState(state)
  return record
}

function addManualProfit(payload) {
  const state = getState()
  const date = String(payload.date || '').trim()
  const amount = roundMoney(payload.amount)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择正确日期')
  if (!Number.isFinite(Number(payload.amount)) || amount === 0) throw new Error('补录金额不能为 0')
  const record = {
    id: uniqueId('mp'),
    businessType: payload.businessType === 'cosmetics' ? 'cosmetics' : 'clothing',
    entryType: payload.entryType === 'expense' || amount < 0 ? 'expense' : 'income',
    date,
    amount,
    note: String(payload.note || '').trim(),
    operator: state.currentUser.name,
    createdAt: nowText()
  }
  state.manualProfits.unshift(record)
  saveState(state)
  return record
}

function removeManualProfit(id) {
  const state = getState()
  const index = state.manualProfits.findIndex(item => item.id === id)
  if (index < 0) throw new Error('补录记录不存在')
  const removed = state.manualProfits.splice(index, 1)[0]
  saveState(state)
  return removed
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function getProfitSummary(period) {
  const state = getState()
  const now = new Date()
  const today = dateKey(now)
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const yesterday = dateKey(yesterdayDate)
  const month = today.slice(0, 7)
  const targetPeriod = period || 'today'
  const sales = state.sales.filter(item => {
    const createdDate = String(item.createdAt || '').slice(0, 10)
    if (targetPeriod === 'yesterday') return createdDate === yesterday
    if (targetPeriod === 'month') return createdDate.slice(0, 7) === month
    return createdDate === today
  })
  const pricedSales = sales.filter(item => item.totalCost !== undefined && item.totalCost !== null && item.grossProfit !== undefined && item.grossProfit !== null)
  const revenue = roundMoney(sales.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0))
  const pricedRevenue = roundMoney(pricedSales.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0))
  const totalCost = roundMoney(pricedSales.reduce((sum, item) => sum + Number(item.totalCost || 0), 0))
  const grossProfit = roundMoney(pricedSales.reduce((sum, item) => sum + Number(item.grossProfit || 0), 0))
  const saleQuantity = sales.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const productMap = {}
  pricedSales.forEach(item => {
    const key = item.productId
    if (!productMap[key]) {
      productMap[key] = { productId: key, productName: item.productName, quantity: 0, revenue: 0, cost: 0, profit: 0 }
    }
    productMap[key].quantity += Number(item.quantity || 0)
    productMap[key].revenue = roundMoney(productMap[key].revenue + Number(item.totalAmount || 0))
    productMap[key].cost = roundMoney(productMap[key].cost + Number(item.totalCost || 0))
    productMap[key].profit = roundMoney(productMap[key].profit + Number(item.grossProfit || 0))
  })
  return {
    period: targetPeriod,
    revenue,
    totalCost,
    grossProfit,
    grossMargin: pricedRevenue ? roundMoney(grossProfit / pricedRevenue * 100) : 0,
    saleQuantity,
    saleCount: sales.length,
    unpricedCount: sales.length - pricedSales.length,
    productProfits: Object.keys(productMap).map(key => productMap[key]).sort((a, b) => b.profit - a.profit),
    records: sales.map(item => ({
      ...item,
      hasProfit: item.grossProfit !== undefined && item.grossProfit !== null
    }))
  }
}

function getProfitOverview() {
  const state = getState()
  const now = new Date()
  const today = dateKey(now)
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const yesterday = dateKey(yesterdayDate)
  const month = today.slice(0, 7)
  const pricedSales = state.sales.filter(item => item.grossProfit !== undefined && item.grossProfit !== null)
  const sumProfit = records => roundMoney(records.reduce((sum, item) => sum + Number(item.grossProfit || 0), 0))
  const sumManualProfit = records => roundMoney(records.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const profitByDate = targetDate => roundMoney(
    sumProfit(pricedSales.filter(item => String(item.createdAt || '').slice(0, 10) === targetDate)) +
    sumManualProfit(state.manualProfits.filter(item => item.date === targetDate))
  )
  const trend = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const key = dateKey(date)
    trend.push({
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      profit: profitByDate(key)
    })
  }
  return {
    totalProfit: roundMoney(sumProfit(pricedSales) + sumManualProfit(state.manualProfits)),
    todayProfit: profitByDate(today),
    yesterdayProfit: profitByDate(yesterday),
    monthProfit: roundMoney(
      sumProfit(pricedSales.filter(item => String(item.createdAt || '').slice(0, 7) === month)) +
      sumManualProfit(state.manualProfits.filter(item => String(item.date || '').slice(0, 7) === month))
    ),
    trend,
    unpricedCount: state.sales.length - pricedSales.length
  }
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function analyzeProfitRecords(records, manualRecords) {
  return summarizeProfitRecords(records, manualRecords)
}

function periodDates(period, customDate) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'yesterday') {
    const target = addDays(today, -1)
    return { start: dateKey(target), end: dateKey(target), previousStart: dateKey(addDays(target, -1)), previousEnd: dateKey(addDays(target, -1)) }
  }
  if (period === 'month') {
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const comparableDay = Math.min(today.getDate(), monthEnd(previousMonth).getDate())
    return {
      start: dateKey(monthStart(today)),
      end: dateKey(today),
      previousStart: dateKey(monthStart(previousMonth)),
      previousEnd: dateKey(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), comparableDay))
    }
  }
  if (period === 'lastMonth') {
    const targetMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1)
    return {
      start: dateKey(monthStart(targetMonth)),
      end: dateKey(monthEnd(targetMonth)),
      previousStart: dateKey(monthStart(previousMonth)),
      previousEnd: dateKey(monthEnd(previousMonth))
    }
  }
  if (period === 'custom' && customDate) {
    const parts = customDate.split('-').map(Number)
    const target = new Date(parts[0], parts[1] - 1, parts[2])
    const previous = addDays(target, -1)
    return { start: dateKey(target), end: dateKey(target), previousStart: dateKey(previous), previousEnd: dateKey(previous) }
  }
  const yesterday = addDays(today, -1)
  return { start: dateKey(today), end: dateKey(today), previousStart: dateKey(yesterday), previousEnd: dateKey(yesterday) }
}

function recordsBetween(records, start, end) {
  return records.filter(item => {
    const key = String(item.createdAt || '').slice(0, 10)
    return key >= start && key <= end
  })
}

function buildTrend(records, manualProfits, range) {
  const now = new Date()
  const trend = []
  if (range === '12months') {
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      const key = monthKey(date)
      const summary = analyzeProfitRecords(
        records.filter(item => String(item.createdAt || '').slice(0, 7) === key),
        manualProfits.filter(item => String(item.date || '').slice(0, 7) === key)
      )
      trend.push({ key, label: `${date.getMonth() + 1}月`, revenue: summary.revenue, profit: summary.profit })
    }
    return trend
  }
  const days = range === '30days' ? 30 : 7
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(now, -offset)
    const key = dateKey(date)
    const summary = analyzeProfitRecords(
      records.filter(item => String(item.createdAt || '').slice(0, 10) === key),
      manualProfits.filter(item => item.date === key)
    )
    trend.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, revenue: summary.revenue, profit: summary.profit })
  }
  return trend
}

function getProfitAnalysis(options) {
  const state = getState()
  const settings = options || {}
  const businessType = settings.businessType || ''
  const sales = state.sales.filter(item => !businessType || recordBusinessType(item, state.products) === businessType)
  const manualProfits = state.manualProfits.filter(item => !businessType || (item.businessType || 'clothing') === businessType)
  const period = settings.period || 'today'
  const dates = periodDates(period, settings.customDate)
  const currentRecords = recordsBetween(sales, dates.start, dates.end)
  const previousRecords = recordsBetween(sales, dates.previousStart, dates.previousEnd)
  const currentManualProfits = manualProfits.filter(item => item.date >= dates.start && item.date <= dates.end)
  const previousManualProfits = manualProfits.filter(item => item.date >= dates.previousStart && item.date <= dates.previousEnd)
  const summary = analyzeProfitRecords(currentRecords, currentManualProfits)
  const previousSummary = analyzeProfitRecords(previousRecords, previousManualProfits)
  const changeAmount = roundMoney(summary.profit - previousSummary.profit)
  const changePercent = previousSummary.profit
    ? roundMoney(changeAmount / Math.abs(previousSummary.profit) * 100)
    : null

  const dailyMap = {}
  currentRecords.forEach(item => {
    const key = String(item.createdAt || '').slice(0, 10)
    if (!dailyMap[key]) dailyMap[key] = []
    dailyMap[key].push(item)
  })
  currentManualProfits.forEach(item => {
    if (!dailyMap[item.date]) dailyMap[item.date] = []
  })
  const dailyRows = Object.keys(dailyMap).sort((a, b) => b.localeCompare(a)).map(key => ({
    date: key,
    ...analyzeProfitRecords(dailyMap[key], currentManualProfits.filter(item => item.date === key))
  }))

  const productMap = {}
  currentRecords.forEach(item => {
    const key = item.productId
    if (!productMap[key]) productMap[key] = { productId: key, productName: item.productName, records: [] }
    productMap[key].records.push(item)
  })
  const productStats = Object.keys(productMap).map(key => ({
    productId: key,
    productName: productMap[key].productName,
    ...analyzeProfitRecords(productMap[key].records)
  }))

  const paymentMap = {}
  currentRecords.forEach(item => {
    const method = item.paymentMethod || '未记录'
    if (!paymentMap[method]) paymentMap[method] = { method, amount: 0, count: 0 }
    paymentMap[method].amount = roundMoney(paymentMap[method].amount + Number(item.totalAmount || 0))
    paymentMap[method].count += 1
  })
  const paymentMethods = Object.keys(paymentMap).map(key => ({
    ...paymentMap[key],
    percent: summary.revenue ? roundMoney(paymentMap[key].amount / summary.revenue * 100) : 0
  })).sort((a, b) => b.amount - a.amount)

  return {
    period,
    start: dates.start,
    end: dates.end,
    summary,
    previousSummary,
    comparison: { amount: changeAmount, percent: changePercent },
    trend: buildTrend(sales, manualProfits, settings.trendRange || '7days'),
    dailyRows,
    productStats,
    paymentMethods,
    manualProfits: currentManualProfits.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }
}

function updateStock(payload) {
  const state = getState()
  const product = state.products.find(item => item.id === payload.productId)
  if (!product) throw new Error('商品不存在')
  if (!isProductActiveStatus(product.status)) throw new Error('商品已停用，请先重新启用')
  const spec = product.specs.find(item => item.id === payload.specId)
  if (!spec) throw new Error('商品规格不存在')

  const before = Number(spec.stock || 0)
  const inputQuantity = Number(payload.quantity)
  let after = before
  let change = 0

  if (payload.type === 'inbound') {
    if (inputQuantity <= 0) throw new Error('入库数量必须大于 0')
    after = before + inputQuantity
    change = inputQuantity
  } else if (payload.type === 'outbound') {
    if (inputQuantity <= 0) throw new Error('出库数量必须大于 0')
    if (inputQuantity > before) throw new Error('出库数量不能超过当前库存')
    after = before - inputQuantity
    change = -inputQuantity
  } else if (payload.type === 'stocktake') {
    if (inputQuantity < 0) throw new Error('实际库存不能小于 0')
    after = inputQuantity
    change = after - before
  } else {
    throw new Error('不支持的库存操作')
  }

  spec.stock = after
  const operation = {
    id: uniqueId('o'),
    type: payload.type,
    productId: product.id,
    productName: product.name,
    businessType: productBusinessType(product),
    specId: spec.id,
    specText: `${spec.color} / ${spec.size}`,
    quantity: change,
    before,
    after,
    reason: payload.reason || '',
    operator: state.currentUser.name,
    createdAt: nowText()
  }
  state.operations.unshift(operation)
  saveState(state)
  return operation
}

module.exports = {
  ensureState,
  getState,
  setCurrentUser,
  replaceStateFromServer,
  replaceProductsFromCatalog,
  getProducts,
  getAllProducts,
  getProduct,
  getSuppliers,
  getBrands,
  getPurchaseRecords,
  getSaleRecords,
  getManualProfitRecords,
  getSummary,
  getProfitSummary,
  getProfitOverview,
  getProfitAnalysis,
  productStock,
  addProduct,
  updateProduct,
  removeProduct,
  addPurchase,
  addSale,
  addManualProfit,
  removeManualProfit,
  updateStock
}
