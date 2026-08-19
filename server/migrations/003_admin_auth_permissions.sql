CREATE TABLE IF NOT EXISTS admin_roles (
  role_key VARCHAR(30) NOT NULL,
  name VARCHAR(40) NOT NULL,
  description VARCHAR(160) NOT NULL DEFAULT '',
  permissions JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id CHAR(36) NOT NULL,
  username VARCHAR(64) NOT NULL,
  display_name VARCHAR(40) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_key VARCHAR(30) NOT NULL,
  permissions JSON NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_accounts_username (username),
  KEY idx_admin_accounts_store (store_id, status),
  CONSTRAINT fk_admin_accounts_store FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT fk_admin_accounts_role FOREIGN KEY (role_key) REFERENCES admin_roles (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_sessions_token (token_hash),
  KEY idx_admin_sessions_account (account_id, expires_at),
  CONSTRAINT fk_admin_sessions_account FOREIGN KEY (account_id) REFERENCES admin_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO admin_roles (role_key, name, description, permissions, sort_order) VALUES
  ('owner', '店主', '拥有全部管理权限，店主账号不可被停用或降级。', JSON_ARRAY(
    'dashboard.view','products.view','products.edit','products.export','inventory.view','inventory.adjust',
    'sales.view','sales.edit','finance.cost.view','finance.profit.view','reports.export',
    'system.staff.manage','system.settings.manage','system.audit.view'
  ), 1),
  ('admin', '管理员', '负责商品、库存和日常运营，可按需增加敏感权限。', JSON_ARRAY(
    'dashboard.view','products.view','products.edit','products.export','inventory.view','inventory.adjust',
    'sales.view','sales.edit','reports.export','system.staff.manage','system.audit.view'
  ), 2),
  ('finance', '财务', '查看经营与财务数据，处理报表及收支。', JSON_ARRAY(
    'dashboard.view','products.view','inventory.view','sales.view','finance.cost.view','finance.profit.view','reports.export'
  ), 3),
  ('clerk', '店员', '仅查看商品、库存并处理日常销售。', JSON_ARRAY(
    'dashboard.view','products.view','inventory.view','sales.view','sales.edit'
  ), 4)
ON DUPLICATE KEY UPDATE
  name=VALUES(name), description=VALUES(description), permissions=VALUES(permissions), sort_order=VALUES(sort_order);

INSERT INTO stores (id, name, status)
VALUES ('00000000-0000-4000-8000-000000000001', '萍萍服饰', 'active')
ON DUPLICATE KEY UPDATE name=VALUES(name), status='active';

INSERT INTO admin_accounts (store_id, username, display_name, password_hash, role_key, status)
SELECT '00000000-0000-4000-8000-000000000001', 'admin', '萍萍',
       'pbkdf2_sha256$210000$pCGP0HnVuwZm22JUQPRbvw==$BPGgZBTcfkfC1SmnnGDREYA1etLUZPP/AEyP5zmPlM4=',
       'owner', 'active'
WHERE NOT EXISTS (SELECT 1 FROM admin_accounts WHERE username = 'admin');
