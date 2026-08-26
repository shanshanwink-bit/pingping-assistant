ALTER TABLE admin_products
  ADD COLUMN item_number VARCHAR(80) NULL AFTER code,
  ADD KEY idx_admin_products_store_item_number (store_id, item_number);
