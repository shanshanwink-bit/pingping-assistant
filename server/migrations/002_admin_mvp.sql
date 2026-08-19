CREATE TABLE IF NOT EXISTS admin_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(40) NOT NULL,
  business_type VARCHAR(20) NOT NULL,
  category VARCHAR(40) NOT NULL,
  spec_count INT UNSIGNED NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT '销售中',
  image_url VARCHAR(1000) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_products_code (code),
  KEY idx_admin_products_filter (business_type, category, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_dashboard_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_amount DECIMAL(12,2) NOT NULL,
  profit DECIMAL(12,2) NOT NULL,
  sold_quantity INT UNSIGNED NOT NULL,
  sales_count INT UNSIGNED NOT NULL,
  inventory_cost DECIMAL(12,2) NOT NULL,
  inventory_quantity INT UNSIGNED NOT NULL,
  trend JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(80) NOT NULL,
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  tone ENUM('danger','warning','primary') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_risk_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_time VARCHAR(40) NOT NULL,
  action_name VARCHAR(80) NOT NULL,
  operator_name VARCHAR(80) NOT NULL,
  status_name VARCHAR(20) NOT NULL,
  tone ENUM('danger','warning') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO admin_dashboard_snapshots
  (sales_amount, profit, sold_quantity, sales_count, inventory_cost, inventory_quantity, trend)
SELECT 1286.00, 528.00, 12, 8, 18420.00, 286, JSON_ARRAY(120,180,140,220,190,250,160)
WHERE NOT EXISTS (SELECT 1 FROM admin_dashboard_snapshots);

INSERT INTO admin_tasks (label, item_count, tone, sort_order)
SELECT '库存差异待确认', 2, 'danger', 1 WHERE NOT EXISTS (SELECT 1 FROM admin_tasks)
UNION ALL SELECT '低库存与缺货', 5, 'warning', 2 WHERE NOT EXISTS (SELECT 1 FROM admin_tasks)
UNION ALL SELECT '商品资料待完善', 4, 'primary', 3 WHERE NOT EXISTS (SELECT 1 FROM admin_tasks);

INSERT INTO admin_risk_logs (display_time, action_name, operator_name, status_name, tone, sort_order)
SELECT '14:32', '库存修正', '萍萍 (店主)', '警告', 'warning', 1 WHERE NOT EXISTS (SELECT 1 FROM admin_risk_logs)
UNION ALL SELECT '11:05', '权限变更', '萍萍 (店主)', '高危', 'danger', 2 WHERE NOT EXISTS (SELECT 1 FROM admin_risk_logs)
UNION ALL SELECT '昨天 18:40', '商品停用', '张三 (店长)', '警告', 'warning', 3 WHERE NOT EXISTS (SELECT 1 FROM admin_risk_logs);

INSERT INTO admin_products
  (name, code, business_type, category, spec_count, stock, price, status, image_url, sort_order, updated_at)
VALUES
  ('针织开衫','PC001','服装','上衣',6,42,129.00,'销售中','https://lh3.googleusercontent.com/aida-public/AB6AXuAU941Mqf2qxKybn70_2S1hzwJwqg11a5scU0Dl__rXQOq8tOc2x8vNOENwExTOrjiip-mNiqheUC4GueHMaSiRuW91NBtCCraEdeZ_iZpkbZ2l-b13jvTlZptzAO4OvXjfKXiVFEWslTwKISZMqmP83DGAGvtjU2D3ZBQRdB-lDweFLLiTR8WVseIx4sMXW9biqrWKLIDGqmQ0hs-7fTE0dk79CO5SovrX3CTuLQlwsUksoVFGDO5q',1,'2026-08-14 10:20:00'),
  ('水洗直筒牛仔裤','PC002','服装','裤子',4,15,169.00,'销售中','https://lh3.googleusercontent.com/aida-public/AB6AXuDa6BSmIAjFdlIOKd8M4CS-wpscway_Pl9a_D9VevYI7nlqpHJDz6fj0yLbcL7vJar-F5VHmDl082Pvur40zSImNvn7slKt7v5Y_qeIejmJsuaifDW4OGkfnp-CxHVzsB5BI2DuMP-PIYMp_4FzRRx7XIOTYejcGG4v-6fIGcOwfa9vt1G9y5y29apOvCvuT9e3Omczgk56Q49gEayOfwZAVgBPee1QOOIGSua-pI9drqMwOSb2SjD9',2,'2026-08-14 09:15:00'),
  ('水润修护精华液','HZ001','化妆品','护肤',1,86,258.00,'销售中','https://lh3.googleusercontent.com/aida-public/AB6AXuD5atXUUj8yU_CWXiTxOz_R8-3vD-9atRaSNWGD6zWNd1vXDe0OirZnMTkqavMILf2HD222dnmatB6scYQLyxj52BMqBmKQ_-uAYqoDxqd6b-erxGEiIXCxHu3ogB14r_Y1jla6JI0yR1JVkulgxPaED4dU7jPfCpe2K4dJTdBF9gIRmHDmpYDxru_V2VmiU0xjmoErUnOKSH0PQr6u0xMyF7Jingu_zrL2tw19U5bmIIIvhmpvcXi5',3,'2026-08-13 15:40:00'),
  ('轻透防晒霜','HZ002','化妆品','护肤',2,0,108.00,'缺货','https://lh3.googleusercontent.com/aida-public/AB6AXuCkhSCHepZqR3f8x6t1yAS04wsbzL_aepyZatl-OE_FN3ph_L92r2SdQgxy33O5lvu4W2wOy2gZhn9Va_IoG9iI3UhGegcTQbZNTv885MKs-H48tQgFHY1ZL55hePymCONa_SYTP_LTi9UCuTU2pgeIlqSgJseSRFn-Y2Ol5g6LnC9-lpnTfLRD92uwaNYPUHgp9Zqk2_f9u0clSu-S9ZqUVeblyNTJ8rkLgRP6z7Q70tOE1KKGTtQb',4,'2026-08-12 11:30:00')
ON DUPLICATE KEY UPDATE
  name=VALUES(name), business_type=VALUES(business_type), category=VALUES(category),
  spec_count=VALUES(spec_count), stock=VALUES(stock), price=VALUES(price), status=VALUES(status),
  image_url=VALUES(image_url), sort_order=VALUES(sort_order), updated_at=VALUES(updated_at);
