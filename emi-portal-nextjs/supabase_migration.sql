-- Idempotent migration for settlement + retailer/contact + pin hash

ALTER TABLE retailers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_settled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS customer_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  settlement_amount_collected NUMERIC(12,2) NOT NULL CHECK (settlement_amount_collected > 0),
  settlement_date DATE NOT NULL,
  note TEXT,
  settled_by_user_id UUID REFERENCES auth.users(id),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_settlements_customer_id ON customer_settlements(customer_id);

UPDATE retailers
SET pin_hash = encode(digest(retail_pin, 'sha256'), 'hex')
WHERE retail_pin IS NOT NULL
  AND (pin_hash IS NULL OR pin_hash = '');

ALTER TABLE retailers ALTER COLUMN pin_hash SET NOT NULL;

ALTER TABLE customer_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_settlements_super_admin_all ON customer_settlements;
CREATE POLICY customer_settlements_super_admin_all
ON customer_settlements
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'super_admin'
  )
);

-- Payment request compatibility fields for mixed collection flows
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS scheduled_emi_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS emi_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS first_emi_charge_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS total_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_for_emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_due_date DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_role TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_user_id UUID;

ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check
CHECK (status IN ('PENDING','APPROVED','REJECTED'));
