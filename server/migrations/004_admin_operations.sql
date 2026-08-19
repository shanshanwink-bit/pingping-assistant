ALTER TABLE admin_products
  ADD COLUMN store_id CHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' AFTER id,
  ADD COLUMN cost_price DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER stock,
  ADD COLUMN low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 5 AFTER cost_price,
  ADD COLUMN location VARCHAR(80) NOT NULL DEFAULT '' AFTER low_stock_threshold,
  ADD KEY idx_admin_products_store (store_id, status),
  ADD CONSTRAINT fk_admin_products_store FOREIGN KEY (store_id) REFERENCES stores (id);

ALTER TABLE admin_products
  DROP INDEX uk_admin_products_code,
  ADD UNIQUE KEY uk_admin_products_store_code (store_id, code);

CREATE TABLE IF NOT EXISTS admin_inventory_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  operation_type ENUM('adjust','sale','reversal','stocktake') NOT NULL,
  before_stock INT NOT NULL,
  quantity_change INT NOT NULL,
  after_stock INT NOT NULL,
  reason VARCHAR(240) NOT NULL,
  reference_type VARCHAR(30) NOT NULL DEFAULT '',
  reference_id BIGINT UNSIGNED NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  operator_name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_store_time (store_id, created_at),
  KEY idx_inventory_product_time (product_id, created_at),
  CONSTRAINT fk_inventory_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES admin_products (id),
  CONSTRAINT fk_inventory_operator FOREIGN KEY (operator_id) REFERENCES admin_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  order_no VARCHAR(40) NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  business_type VARCHAR(20) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  cost_amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(40) NOT NULL,
  status ENUM('effective','reversed') NOT NULL DEFAULT 'effective',
  operator_id BIGINT UNSIGNED NOT NULL,
  operator_name VARCHAR(80) NOT NULL,
  reason VARCHAR(240) NOT NULL DEFAULT '',
  reversed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_sales_order (store_id, order_no),
  KEY idx_admin_sales_store_time (store_id, created_at),
  CONSTRAINT fk_admin_sales_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_admin_sales_product FOREIGN KEY (product_id) REFERENCES admin_products (id),
  CONSTRAINT fk_admin_sales_operator FOREIGN KEY (operator_id) REFERENCES admin_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_finance_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  entry_type ENUM('income','expense') NOT NULL,
  category VARCHAR(60) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  business_type VARCHAR(20) NOT NULL DEFAULT '全部',
  note VARCHAR(240) NOT NULL DEFAULT '',
  status ENUM('effective','reversed') NOT NULL DEFAULT 'effective',
  operator_id BIGINT UNSIGNED NOT NULL,
  operator_name VARCHAR(80) NOT NULL,
  reason VARCHAR(240) NOT NULL DEFAULT '',
  reversed_at TIMESTAMP NULL,
  occurred_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_finance_store_date (store_id, occurred_on),
  CONSTRAINT fk_finance_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_finance_operator FOREIGN KEY (operator_id) REFERENCES admin_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  setting_group VARCHAR(30) NOT NULL,
  setting_key VARCHAR(60) NOT NULL,
  label VARCHAR(80) NOT NULL,
  setting_value VARCHAR(240) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_setting (store_id, setting_group, setting_key),
  CONSTRAINT fk_admin_settings_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  operator_name VARCHAR(80) NOT NULL,
  operator_role VARCHAR(40) NOT NULL,
  action VARCHAR(80) NOT NULL,
  object_type VARCHAR(40) NOT NULL,
  object_id VARCHAR(80) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  reason VARCHAR(240) NOT NULL DEFAULT '',
  request_id VARCHAR(80) NOT NULL DEFAULT '',
  source VARCHAR(30) NOT NULL DEFAULT '管理后台',
  risk_level ENUM('normal','warning','danger') NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_store_time (store_id, created_at),
  KEY idx_audit_operator (operator_id, created_at),
  CONSTRAINT fk_admin_audit_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_admin_audit_operator FOREIGN KEY (operator_id) REFERENCES admin_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO admin_settings (store_id, setting_group, setting_key, label, setting_value, enabled, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000001','category_clothing','tops','上衣','上衣',1,1),
  ('00000000-0000-4000-8000-000000000001','category_clothing','pants','裤子','裤子',1,2),
  ('00000000-0000-4000-8000-000000000001','category_cosmetics','skincare','护肤','护肤',1,1),
  ('00000000-0000-4000-8000-000000000001','category_cosmetics','makeup','彩妆','彩妆',1,2),
  ('00000000-0000-4000-8000-000000000001','payment_method','wechat','微信支付','微信支付',1,1),
  ('00000000-0000-4000-8000-000000000001','payment_method','cash','现金','现金',1,2),
  ('00000000-0000-4000-8000-000000000001','inventory_rule','low_stock','默认低库存阈值','5',1,1),
  ('00000000-0000-4000-8000-000000000001','inventory_rule','approval_delta','库存差异复核阈值','20',1,2)
ON DUPLICATE KEY UPDATE label=VALUES(label), sort_order=VALUES(sort_order);

UPDATE admin_products SET cost_price = ROUND(price * 0.55, 2), low_stock_threshold = 5
WHERE cost_price = 0;

UPDATE admin_roles SET permissions = JSON_ARRAY_APPEND(permissions, '$', 'finance.entry.edit')
WHERE role_key = 'finance' AND JSON_CONTAINS(permissions, JSON_QUOTE('finance.entry.edit')) = 0;
