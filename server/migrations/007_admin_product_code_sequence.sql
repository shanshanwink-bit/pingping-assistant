CREATE TABLE IF NOT EXISTS admin_product_code_sequences (
  store_id CHAR(36) NOT NULL,
  next_number BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id),
  CONSTRAINT fk_admin_product_code_sequence_store FOREIGN KEY (store_id) REFERENCES stores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO admin_product_code_sequences (store_id, next_number)
SELECT s.id,
  COALESCE(MAX(CASE WHEN p.code REGEXP '^[0-9]+$' THEN CAST(p.code AS UNSIGNED) END), 0) + 1
FROM stores s
LEFT JOIN admin_products p ON p.store_id = s.id
GROUP BY s.id
ON DUPLICATE KEY UPDATE next_number = GREATEST(next_number, VALUES(next_number));
