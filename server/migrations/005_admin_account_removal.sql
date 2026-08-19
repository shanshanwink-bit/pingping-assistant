ALTER TABLE admin_accounts
  MODIFY COLUMN status ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active';
