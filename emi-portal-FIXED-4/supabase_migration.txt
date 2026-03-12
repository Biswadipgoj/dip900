-- ============================================================
-- EMI PORTAL — INCREMENTAL MIGRATION
-- Run this file in Supabase → SQL Editor → Run
-- Safe to run multiple times (idempotent)
-- ============================================================

-- ============================================================
-- 1. Add mobile column to retailers
-- ============================================================
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS mobile TEXT;

-- Optional: add check constraint (10-digit Indian mobile)
-- ALTER TABLE retailers ADD CONSTRAINT retailers_mobile_length CHECK (mobile IS NULL OR LENGTH(mobile) = 10);

-- ============================================================
-- 2. Add emi_no and fine_for_emi_no fields to payment_requests
--    for clearer receipt data
-- ============================================================
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS emi_no            INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_for_emi_no   INT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS fine_due_date      DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS scheduled_emi_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_role TEXT CHECK (collected_by_role IN ('admin', 'retailer'));
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES auth.users(id);

-- ============================================================
-- 3. Fix customers table — ensure aadhaar is NOT required in DB
--    (frontend enforces it, but some existing rows may be null)
-- ============================================================
-- The existing CHECK only validates length IF aadhaar is present.
-- No change needed — existing constraint: CHECK (LENGTH(aadhaar) = 12)
-- allows NULL by default in PostgreSQL.

-- ============================================================
-- 4. Retailer RLS update — allow service role to read retailers
--    so receipt API can join retailer mobile
-- ============================================================

-- Ensure service role can read everything (it bypasses RLS by default)
-- No additional policy needed for service_role

-- ============================================================
-- 5. Update existing retailers display
-- ============================================================
-- No data migration needed. mobile is NULL by default.

-- ============================================================
-- 6. Grant execute on any new functions if added
-- ============================================================
-- (No new functions in this migration)

-- ============================================================
-- DONE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE 'EMI Portal incremental migration completed.';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '  - retailers.mobile (optional TEXT column)';
  RAISE NOTICE '  - payment_requests: emi_no, fine_for_emi_no,';
  RAISE NOTICE '    fine_due_date, scheduled_emi_amount,';
  RAISE NOTICE '    collected_by_role, collected_by_user_id';
  RAISE NOTICE '================================================';
END $$;
