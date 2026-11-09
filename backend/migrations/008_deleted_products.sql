ALTER TABLE products ADD COLUMN deleted_at timestamptz;
ALTER TABLE products ADD CONSTRAINT deleted_products_inactive
  CHECK (deleted_at IS NULL OR NOT active);
