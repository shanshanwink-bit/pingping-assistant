const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const project = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(project, file), 'utf8')

test('physical product deletion is owner-only and exposes stable business error codes', () => {
  const service = source('server-go/internal/service/business.go')
  const errors = source('server-go/internal/httpapi/server.go')
  assert.match(service, /actor\.Role != "owner"/)
  assert.match(service, /ErrProductDeleteForbidden/)
  assert.match(errors, /PRODUCT_DELETE_FORBIDDEN/)
  assert.match(errors, /PRODUCT_HAS_HISTORY/)
  assert.match(errors, /http\.StatusForbidden/)
  assert.match(errors, /http\.StatusConflict/)
  assert.match(errors, /payload\["reasons"\] = reasons/)
})

test('deletion qualification checks every persisted stock and business-history source', () => {
  const repository = source('server-go/internal/repository/product_deletion.go')
  for (const contract of [
    /candidate\.Stock != 0/,
    /inspection\.specStock != 0/,
    /FROM admin_sales WHERE store_id=\? AND product_id=\?/,
    /FROM admin_inventory_operations WHERE store_id=\? AND product_id=\?/,
    /inspection\.sales > 0/,
    /inspection\.purchases > 0/,
    /inspection\.operations > 0/,
    /FROM audit_logs/,
    /miniapp\.sale\.create/,
    /miniapp\.purchase\.create/
  ]) assert.match(repository, contract)
  assert.match(repository, /该商品已有采购记录，不能永久删除，请停用商品。/)
})

test('delete transaction locks shared state before product and never deletes history', () => {
  const repository = source('server-go/internal/repository/product_deletion.go')
  const stateLock = repository.indexOf('SELECT state,revision FROM store_states')
  const productLock = repository.indexOf('SELECT id,code,item_number,name,stock FROM admin_products')
  const stateUpdate = repository.indexOf('UPDATE store_states')
  const productDelete = repository.indexOf('DELETE FROM admin_products')
  const auditInsert = repository.indexOf('INSERT INTO admin_audit_logs')
  const commit = repository.lastIndexOf('tx.Commit()')
  assert.ok(stateLock >= 0 && stateLock < productLock)
  assert.match(repository, /lockClause = " FOR UPDATE"/)
  assert.ok(stateUpdate < productDelete && productDelete < auditInsert && auditInsert < commit)
  assert.doesNotMatch(repository, /DELETE FROM (admin_sales|admin_inventory_operations|audit_logs|admin_audit_logs)/)
  assert.match(repository, /defer tx\.Rollback\(\)/)
  assert.match(repository, /revision=revision\+1/)
})

test('Node sale, purchase and batch commits share the same store-state-first lock order', () => {
  const app = source('server/src/app.js')
  const batch = source('server/src/batch-purchases.js')
  const appStateLock = app.indexOf('SELECT state, revision FROM store_states WHERE store_id = ? FOR UPDATE')
  const appProductLock = app.indexOf('SELECT status FROM admin_products WHERE id = ? AND store_id = ? FOR UPDATE', appStateLock)
  const batchStateLock = batch.indexOf('SELECT state, revision FROM store_states WHERE store_id = ? FOR UPDATE')
  const batchProductLock = batch.indexOf('assertBatchProductsActive', batchStateLock)
  assert.ok(appStateLock >= 0 && appStateLock < appProductLock)
  assert.ok(batchStateLock >= 0 && batchStateLock < batchProductLock)
  assert.match(app, /后台商品已发生变化，请返回商品页刷新/)
  assert.match(batch, /后台商品已发生变化，请返回商品页刷新/)
})

test('mini-program has no unvalidated local deletion path or code compaction', () => {
  const store = source('utils/store.js')
  assert.doesNotMatch(store, /function removeProduct|\bremoveProduct,/)
  assert.doesNotMatch(store, /compactProductCodes/)
  assert.match(store, /Math\.max\([\s\S]*migratedNextNumber/)
})

test('Web only shows qualified owner deletion with a second confirmation', () => {
  const view = source('admin/src/views/ProductsView.vue')
  const api = source('admin/src/services/api.js')
  assert.match(api, /products\/\$\{id\}\/deletion-eligibility/)
  assert.match(api, /method: 'DELETE'/)
  assert.match(view, /currentUser\?\.role===['"]owner['"]/) // owner only
  assert.match(view, /editing\.id&&canDeleteProducts/)
  assert.match(view, /editingDeletionEligibility\?\.canDelete/)
  assert.match(view, /仅零库存且无经营历史的商品可以永久删除。/)
  assert.match(view, /该商品已有经营记录，为保留历史数据不可永久删除；如不再经营，可停用商品。/)
  assert.match(view, /该商品尚无经营记录，将永久删除商品档案，此操作不可撤销。/)
  assert.match(view, /pendingConfirm\.kind===['"]delete['"]\?['"]永久删除['"]/) // unified dialog
  assert.doesNotMatch(view, /@click="requestDelete\(p\)"/)
  assert.match(view, /@click="requestDelete\(editing\)"/)
  assert.doesNotMatch(view, /window\.confirm/)
  assert.doesNotMatch(view, /强制删除/)
})

test('Web deactivation uses the same business confirmation from list and edit form', () => {
  const view = source('admin/src/views/ProductsView.vue')
  assert.match(view, /停用后，该商品将不再参与卖货、拿货和普通 AI 匹配，历史记录仍会保留。确定停用吗？/)
  assert.match(view, /kind:['"]inactive['"]/)
  assert.match(view, /kind:['"]save-inactive['"]/)
  assert.match(view, /确认停用/)
  assert.match(view, /if\(isProductActiveStatus\(p\.status\)\)/)
})

test('deletion audit records identifiers, operator context, request and eligibility summary', () => {
  const repository = source('server-go/internal/repository/product_deletion.go')
  for (const contract of [
    /商品内部ID=%s/,
    /adminProductId=%d/,
    /code=%s/,
    /itemNumber=%s/,
    /商品名称=%s/,
    /operator_id/,
    /operator_name/,
    /request_id/,
    /删除资格=聚合库存0/
  ]) assert.match(repository, contract)
})

test('all product-code allocators are monotonic and never compact or recycle codes', () => {
  const goProducts = source('server-go/internal/repository/operations.go')
  const store = source('utils/store.js')
  assert.match(goProducts, /SET next_number=\?[^\n]*nextNumber\+1/)
  assert.doesNotMatch(`${goProducts}\n${store}`, /compactProductCodes|next_number\s*=\s*next_number\s*-|DELETE FROM admin_product_code_sequences/)
})
