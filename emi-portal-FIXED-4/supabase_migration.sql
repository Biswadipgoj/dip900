-- ============================================================
-- EMI PORTAL — COMPREHENSIVE MIGRATION v2
-- Run this file in Supabase → SQL Editor → Run
-- Safe to run multiple times (idempotent via IF NOT EXISTS / ON CONFLICT)
-- ============================================================

-- ============================================================
-- 1. Add mobile column to retailers (if not already present)
-- ============================================================
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS retail_pin TEXT;

-- ============================================================
-- 2. Ensure customers table has correct column names
--    (Some older installs used photo_url instead of customer_photo_url)
-- ============================================================
DO $$
BEGIN
  -- Rename photo_url to customer_photo_url if old column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'photo_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'customer_photo_url'
  ) THEN
    ALTER TABLE customers RENAME COLUMN photo_url TO customer_photo_url;
  END IF;

  -- Rename bill_url to bill_photo_url if old column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'bill_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'bill_photo_url'
  ) THEN
    ALTER TABLE customers RENAME COLUMN bill_url TO bill_photo_url;
  END IF;
END $$;

-- Add missing image columns to customers if they don't exist
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_photo_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS aadhaar_front_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS aadhaar_back_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bill_photo_url TEXT;

-- ============================================================
-- 3. Add extra metadata columns to payment_requests
-- ============================================================
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_for_emi_no INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_due_date DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS scheduled_emi_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_role TEXT
  CHECK (collected_by_role IN ('admin', 'retailer'));
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_user_id UUID
  REFERENCES auth.users(id);
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS selected_emi_nos INT[];

-- ============================================================
-- 4. Add collected_by columns to emi_schedule
-- ============================================================
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS collected_by_role TEXT;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS collected_by_user_id UUID
  REFERENCES auth.users(id);

-- ============================================================
-- 5. Ensure audit_log uses correct column names
-- ============================================================
DO $$
BEGIN
  -- Some installs may have user_id instead of actor_user_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'actor_user_id'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN user_id TO actor_user_id;
  END IF;
END $$;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES auth.users(id);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS record_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_data JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_data JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS remark TEXT;

-- ============================================================
-- 6. RLS Policies
-- ============================================================

-- Enable RLS on all core tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_settings ENABLE ROW LEVEL SECURITY;

-- Drop stale policies to avoid conflicts
DROP POLICY IF EXISTS "profiles_self" ON profiles;
DROP POLICY IF EXISTS "retailers_admin_all" ON retailers;
DROP POLICY IF EXISTS "retailers_self" ON retailers;
DROP POLICY IF EXISTS "customers_admin_all" ON customers;
DROP POLICY IF EXISTS "customers_retailer_own" ON customers;
DROP POLICY IF EXISTS "emi_admin_all" ON emi_schedule;
DROP POLICY IF EXISTS "emi_retailer_own" ON emi_schedule;
DROP POLICY IF EXISTS "payments_admin_all" ON payment_requests;
DROP POLICY IF EXISTS "payments_retailer_own" ON payment_requests;
DROP POLICY IF EXISTS "payment_items_admin_all" ON payment_request_items;
DROP POLICY IF EXISTS "payment_items_retailer_own" ON payment_request_items;
DROP POLICY IF EXISTS "fine_settings_read" ON fine_settings;
DROP POLICY IF EXISTS "fine_settings_admin_write" ON fine_settings;
DROP POLICY IF EXISTS "audit_admin_all" ON audit_log;

-- Profiles: users can only read/write their own profile
CREATE POLICY "profiles_self" ON profiles
  FOR ALL USING (auth.uid() = user_id);

-- Retailers: admin sees all, retailer sees own record
CREATE POLICY "retailers_admin_all" ON retailers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );
CREATE POLICY "retailers_self" ON retailers
  FOR SELECT USING (auth_user_id = auth.uid());

-- Customers: admin sees all, retailer sees only own
CREATE POLICY "customers_admin_all" ON customers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );
CREATE POLICY "customers_retailer_own" ON customers
  FOR SELECT USING (
    retailer_id IN (
      SELECT id FROM retailers WHERE auth_user_id = auth.uid()
    )
  );

-- EMI Schedule: admin sees all, retailer sees own customers
CREATE POLICY "emi_admin_all" ON emi_schedule
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );
CREATE POLICY "emi_retailer_own" ON emi_schedule
  FOR SELECT USING (
    customer_id IN (
      SELECT c.id FROM customers c
      JOIN retailers r ON r.id = c.retailer_id
      WHERE r.auth_user_id = auth.uid()
    )
  );

-- Payment requests: admin sees all, retailer sees own
CREATE POLICY "payments_admin_all" ON payment_requests
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );
CREATE POLICY "payments_retailer_own" ON payment_requests
  FOR SELECT USING (
    retailer_id IN (
      SELECT id FROM retailers WHERE auth_user_id = auth.uid()
    )
  );

-- Payment request items: admin sees all, retailer sees own
CREATE POLICY "payment_items_admin_all" ON payment_request_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );
CREATE POLICY "payment_items_retailer_own" ON payment_request_items
  FOR SELECT USING (
    payment_request_id IN (
      SELECT pr.id FROM payment_requests pr
      JOIN retailers r ON r.id = pr.retailer_id
      WHERE r.auth_user_id = auth.uid()
    )
  );

-- Fine settings: everyone can read, only admin can write
CREATE POLICY "fine_settings_read" ON fine_settings
  FOR SELECT USING (true);
CREATE POLICY "fine_settings_admin_write" ON fine_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- Audit log: admin sees all
CREATE POLICY "audit_admin_all" ON audit_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 7. get_due_breakdown() — ensure this function exists
-- ============================================================
CREATE OR REPLACE FUNCTION get_due_breakdown(p_customer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_customer RECORD;
  v_next_emi RECORD;
  v_fine_setting RECORD;
  v_fine_due NUMERIC := 0;
  v_first_emi_charge_due NUMERIC := 0;
  v_total_payable NUMERIC := 0;
  v_popup_first_emi_charge BOOLEAN := FALSE;
  v_popup_fine_due BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RETURN '{"error": "Customer not found"}'::JSONB;
  END IF;

  SELECT * INTO v_fine_setting FROM fine_settings WHERE id = 1;

  -- Get next unpaid EMI
  SELECT * INTO v_next_emi
  FROM emi_schedule
  WHERE customer_id = p_customer_id AND status = 'UNPAID'
  ORDER BY emi_no ASC
  LIMIT 1;

  -- Fine: only if next EMI due_date has passed
  IF FOUND AND v_next_emi.due_date < CURRENT_DATE AND NOT v_next_emi.fine_waived THEN
    v_fine_due := COALESCE(v_next_emi.fine_amount, 0);
    IF v_fine_due = 0 THEN
      v_fine_due := COALESCE(v_fine_setting.default_fine_amount, 0);
    END IF;
    v_popup_fine_due := TRUE;
  END IF;

  -- First EMI charge: due if not yet paid
  IF v_customer.first_emi_charge_amount > 0 AND v_customer.first_emi_charge_paid_at IS NULL THEN
    v_first_emi_charge_due := v_customer.first_emi_charge_amount;
    v_popup_first_emi_charge := TRUE;
  END IF;

  v_total_payable := COALESCE(v_next_emi.amount, 0) + v_fine_due + v_first_emi_charge_due;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'customer_status', v_customer.status,
    'next_emi_no', v_next_emi.emi_no,
    'next_emi_amount', v_next_emi.amount,
    'next_emi_due_date', v_next_emi.due_date,
    'next_emi_status', v_next_emi.status,
    'fine_due', v_fine_due,
    'first_emi_charge_due', v_first_emi_charge_due,
    'total_payable', v_total_payable,
    'popup_first_emi_charge', v_popup_first_emi_charge,
    'popup_fine_due', v_popup_fine_due,
    'is_overdue', (v_next_emi.due_date IS NOT NULL AND v_next_emi.due_date < CURRENT_DATE)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID) TO service_role;

-- ============================================================
-- 8. Additional indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_due_date_status ON emi_schedule(due_date, status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);

-- ============================================================
-- DONE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE 'EMI Portal migration v2 completed.';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  - retailers.mobile, retail_pin';
  RAISE NOTICE '  - customers image columns renamed/added';
  RAISE NOTICE '  - payment_requests: fine_for_emi_no, fine_due_date,';
  RAISE NOTICE '    scheduled_emi_amount, collected_by_role/user_id,';
  RAISE NOTICE '    selected_emi_nos';
  RAISE NOTICE '  - RLS policies set for all tables';
  RAISE NOTICE '  - get_due_breakdown() function created/updated';
  RAISE NOTICE '================================================';
END $$;
