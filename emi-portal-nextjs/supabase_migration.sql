-- Idempotent migration for settlement + partial collections + retailer mobile
ALTER TABLE IF EXISTS retailers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE IF EXISTS retailers ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS is_settled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS first_emi_charge_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS emi_schedule ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS customer_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  settlement_amount_collected NUMERIC(12,2) NOT NULL CHECK (settlement_amount_collected > 0),
  settlement_date DATE NOT NULL,
  note TEXT,
  settled_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_settlements_customer_id ON customer_settlements(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_settlements_settled_at ON customer_settlements(settled_at DESC);

ALTER TABLE customer_settlements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY customer_settlements_super_admin_all ON customer_settlements
    FOR ALL USING (get_my_role() = 'super_admin')
    WITH CHECK (get_my_role() = 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
