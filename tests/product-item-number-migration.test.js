const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.join(__dirname, '..', 'server', 'migrations', '008_admin_product_item_number.sql')
const managedMigrationPath = path.join(__dirname, '..', 'server', 'migrations', '009_admin_product_item_number_managed.sql')

test('item number migration is nullable, non-unique and does not backfill legacy codes', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')
  assert.match(sql, /ADD COLUMN item_number VARCHAR\(80\) NULL/i)
  assert.match(sql, /ADD KEY idx_admin_products_store_item_number \(store_id, item_number\)/i)
  assert.doesNotMatch(sql, /UNIQUE/i)
  assert.doesNotMatch(sql, /UPDATE\s+admin_products/i)
  assert.doesNotMatch(sql, /barcode|is_active|deleted_at/i)
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'server', 'migrations', '008_admin_product_item_item_number.sql')), false)
})

test('explicit-clear migration adds only minimal legacy distinction metadata', () => {
  const sql = fs.readFileSync(managedMigrationPath, 'utf8')
  assert.match(sql, /ADD COLUMN item_number_managed TINYINT\(1\) NOT NULL DEFAULT 0/i)
  assert.doesNotMatch(sql, /UPDATE\s+admin_products|barcode|deleted_at|is_active/i)
})

test('item number migrations keep deterministic 008 then 009 order', () => {
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'server', 'migrations'))
    .filter(name => /^00[89]_admin_product_item_number/.test(name))
    .sort()
  assert.deepEqual(migrations, [
    '008_admin_product_item_number.sql',
    '009_admin_product_item_number_managed.sql'
  ])
})
