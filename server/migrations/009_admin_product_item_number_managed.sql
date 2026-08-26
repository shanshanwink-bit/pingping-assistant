ALTER TABLE admin_products
  ADD COLUMN item_number_managed TINYINT(1) NOT NULL DEFAULT 0 AFTER item_number;
