const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const project = path.resolve(__dirname, '..')
const adminSource = file => fs.readFileSync(path.join(project, 'admin', 'src', file), 'utf8')
const importAdmin = file => import(pathToFileURL(path.join(project, 'admin', 'src', file)).href)

test('CSV correctly escapes comma, quote and newline', async () => {
  const { csvText } = await importAdmin('utils/csv.js')
  const text = csvText([['逗号,商品', '双"引号', '两\n行']])
  assert.equal(text, '\ufeff"逗号,商品","双""引号","两\n行"')
})

test('business date uses China timezone at UTC boundary', async () => {
  const { businessDate } = await importAdmin('utils/businessDate.js')
  assert.equal(businessDate(new Date('2026-08-18T16:30:00.000Z')), '2026-08-19')
})

test('navigation only exposes pages granted to the current account', async () => {
  const { visibleNavItems } = await importAdmin('utils/access.js')
  const items = visibleNavItems({ role: 'clerk', permissions: ['dashboard.view', 'sales.view'] })
  assert.deepEqual(items.map(item => item.id), ['dashboard', 'sales'])
  assert.ok(!items.some(item => item.label === '采购与供应商' || item.label === '基础设置'))

  const finance = visibleNavItems({ role: 'finance', permissions: ['dashboard.view', 'sales.view', 'finance.profit.view'] })
  assert.deepEqual(finance.map(item => item.id), ['dashboard', 'sales', 'analysis'])

  const owner = visibleNavItems({ role: 'owner', permissions: [] })
  assert.deepEqual(owner.map(item => item.id), ['dashboard', 'products', 'inventory', 'sales', 'analysis', 'employees', 'audit'])
})

test('write buttons are permission-gated and safe product deletion is owner-only', () => {
  const products = adminSource('views/ProductsView.vue')
  const employees = adminSource('views/EmployeesView.vue')
  assert.match(products, /v-if="canEdit"/)
  assert.match(products, /v-if="canExport"/)
  assert.match(employees, /v-if="canManage"/)
  assert.match(products, /currentUser\?\.role===['"]owner['"]/)
  assert.match(products, /editing\.id&&canDeleteProducts/)
  assert.match(products, /editingDeletionEligibility\?\.canDelete/)
  assert.match(products, /永久删除商品/)
  assert.match(products, /该商品尚无经营记录，将永久删除商品档案，此操作不可撤销。/)
  assert.doesNotMatch(products, /@click="requestDelete\(p\)"/)
  assert.doesNotMatch(products, /强制删除/)
})

test('product editing preserves itemNumber while code remains server-controlled', () => {
  const products = adminSource('views/ProductsView.vue')
  assert.match(products, /blank=.*itemNumber:''/)
  assert.match(products, /filter\(key=>key!==['"]code['"]\)/)
  assert.match(products, /货号（选填）/)
  assert.match(products, /可填写吊牌、进货单或供应商货号/)
})

test('inventory and dashboard use truthful aggregate stock semantics', () => {
  const inventory = adminSource('views/InventoryView.vue')
  const dashboard = adminSource('views/DashboardView.vue')
  assert.match(inventory, /规格库存请通过小程序经营流程维护/)
  assert.doesNotMatch(inventory, /@click="openAdjust|api\.adjustStock/)
  assert.match(dashboard, /lowStockThreshold/)
  assert.doesNotMatch(dashboard, /stock[^\n]*<=\s*10/)
})

test('duplicate operating entry points and template placeholders are absent', () => {
  const sales = adminSource('views/SalesFinanceView.vue')
  const employees = adminSource('views/EmployeesView.vue')
  const api = adminSource('services/api.js')
  assert.doesNotMatch(sales, /新增销售|记一笔收支|createSale|createFinanceEntry/)
  assert.doesNotMatch(employees, /TEAM & ACCESS|NEW ACCOUNT|ACCESS SETTINGS/)
  assert.equal(fs.existsSync(path.join(project, 'admin', 'src', 'views', 'SettingsView.vue')), false)
  assert.match(api, /productDeletionEligibility/)
  assert.match(api, /deleteProduct/)
  assert.doesNotMatch(api, /adjustStock|createSale|reverseSale|createFinanceEntry|reverseFinanceEntry|saveSetting/)
})

test('WeChat package excludes non-miniprogram workspaces and retired proposal CSS', () => {
  const config = JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8'))
  const ignored = config.packOptions.ignore.map(item => item.value)
  assert.deepEqual(ignored, ['admin', 'docs', 'outputs', 'server', 'server-go', 'tests'])
  assert.doesNotMatch(fs.readFileSync(path.join(project, 'app.wxss'), 'utf8'), /proposal-layout/)
  assert.equal(fs.existsSync(path.join(project, 'styles', 'proposal-layout.wxss')), false)
})
