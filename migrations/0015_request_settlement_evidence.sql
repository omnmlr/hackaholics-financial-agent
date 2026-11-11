ALTER TABLE agus_payment_requests ADD COLUMN cancelled_at timestamptz;
ALTER TABLE agus_payment_requests ADD COLUMN settlement_observed_at timestamptz;
ALTER TABLE agus_payment_requests ADD COLUMN settlement_block_time timestamptz;
