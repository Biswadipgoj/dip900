-- ============================================================
-- MIGRATION 009: Complete fine system + broadcast sender + all fixes
-- Run in Supabase SQL Editor (idempotent)
-- ============================================================

-- ── 1. Fine settings columns ────────────────────────────────
ALTER TABLE fine_settings ADD COLUMN IF NOT EXISTS weekly_fine_increment NUMERIC(12,2) DEFAULT 25;

-- ── 2. Ensure all columns exist ─────────────────────────────
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_last_calculated_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS fine_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_start_date DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emi_card_photo_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS settlement_date DATE;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS utr TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT 'TELEPOINT';
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'admin';

-- ── 3. Customer status constraint ───────────────────────────
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('RUNNING', 'COMPLETE', 'SETTLED', 'NPA'));

-- ── 4. Fine History table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  emi_schedule_id UUID REFERENCES emi_schedule(id) ON DELETE CASCADE,
  emi_no          INT,
  fine_type       TEXT NOT NULL CHECK (fine_type IN ('BASE', 'WEEKLY', 'MONTHLY_RESET', 'PAID', 'WAIVED')),
  fine_amount     NUMERIC(12,2) NOT NULL,
  cumulative_fine NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  reason          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fine_history_customer ON fine_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_fine_history_emi ON fine_history(emi_schedule_id);
CREATE INDEX IF NOT EXISTS idx_fine_history_date ON fine_history(fine_date);

ALTER TABLE fine_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fine_history_admin_all" ON fine_history;
DROP POLICY IF EXISTS "fine_history_retailer" ON fine_history;
DROP POLICY IF EXISTS "fine_history_insert" ON fine_history;
CREATE POLICY "fine_history_admin_all" ON fine_history FOR ALL USING (get_my_role() = 'super_admin');
CREATE POLICY "fine_history_retailer" ON fine_history FOR SELECT USING (
  get_my_role() = 'retailer' AND
  customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id())
);
CREATE POLICY "fine_history_insert" ON fine_history FOR INSERT WITH CHECK (TRUE);

-- ── 5. Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_requests_utr ON payment_requests(utr);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_utr ON emi_schedule(utr);

-- ── 6. Fine Engine with MONTHLY RESET ───────────────────────
CREATE OR REPLACE FUNCTION calculate_and_apply_fines()
RETURNS TABLE(updated_count INT) AS $$
DECLARE
  v_base_fine        NUMERIC;
  v_weekly_increment NUMERIC;
  v_fine_per_month   NUMERIC;
  v_count            INT := 0;
  v_emi              RECORD;
  v_days_overdue     INT;
  v_completed_months INT;
  v_remaining_days   INT;
  v_weeks_in_current INT;
  v_calculated_fine  NUMERIC;
  v_old_fine         NUMERIC;
BEGIN
  SELECT default_fine_amount, COALESCE(weekly_fine_increment, 25)
  INTO v_base_fine, v_weekly_increment
  FROM fine_settings WHERE id = 1;
  IF v_base_fine IS NULL THEN v_base_fine := 450; END IF;
  IF v_weekly_increment IS NULL THEN v_weekly_increment := 25; END IF;
  v_fine_per_month := v_base_fine + (4 * v_weekly_increment);

  FOR v_emi IN
    SELECT es.id, es.customer_id, es.emi_no, es.due_date,
           es.fine_amount, es.fine_paid_amount, es.fine_waived
    FROM emi_schedule es
    JOIN customers c ON c.id = es.customer_id
    WHERE es.status = 'UNPAID'
      AND es.due_date < CURRENT_DATE
      AND es.fine_waived = FALSE
      AND c.status = 'RUNNING'
  LOOP
    v_days_overdue := CURRENT_DATE - v_emi.due_date;
    IF v_days_overdue <= 0 THEN CONTINUE; END IF;

    v_completed_months := v_days_overdue / 30;
    v_remaining_days   := v_days_overdue % 30;
    v_calculated_fine  := v_completed_months * v_fine_per_month;
    IF v_remaining_days > 0 THEN
      v_weeks_in_current := v_remaining_days / 7;
      v_calculated_fine := v_calculated_fine + v_base_fine + (v_weeks_in_current * v_weekly_increment);
    END IF;

    v_old_fine := COALESCE(v_emi.fine_amount, 0);
    IF v_calculated_fine != v_old_fine THEN
      UPDATE emi_schedule
      SET fine_amount = v_calculated_fine, fine_last_calculated_at = NOW(), updated_at = NOW()
      WHERE id = v_emi.id;

      INSERT INTO fine_history (customer_id, emi_schedule_id, emi_no, fine_type, fine_amount, cumulative_fine, fine_date, reason)
      VALUES (v_emi.customer_id, v_emi.id, v_emi.emi_no,
        CASE WHEN v_old_fine = 0 THEN 'BASE'
             WHEN v_completed_months > 0 AND v_remaining_days <= 1 THEN 'MONTHLY_RESET'
             ELSE 'WEEKLY' END,
        v_calculated_fine - v_old_fine, v_calculated_fine, CURRENT_DATE,
        'Auto: ' || v_days_overdue || 'd overdue, ' || v_completed_months || 'mo + ' || v_remaining_days || 'd. ' || v_old_fine || '→' || v_calculated_fine);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calculate_and_apply_fines() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_and_apply_fines() TO service_role;

-- ── 7. Broadcast RLS for retailers ──────────────────────────
DROP POLICY IF EXISTS "broadcast_retailer_insert" ON broadcast_messages;
CREATE POLICY "broadcast_retailer_insert" ON broadcast_messages
  FOR INSERT WITH CHECK (
    get_my_role() = 'retailer' AND target_retailer_id = get_my_retailer_id()
  );

-- ── 8. Run fine calculation ─────────────────────────────────
SELECT * FROM calculate_and_apply_fines();

-- ── 9. Cron job ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('calculate-fines-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('calculate-fines-daily', '0 0 * * *', 'SELECT calculate_and_apply_fines()');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'Migration 009 complete. Fine system with monthly reset + fine_history.';
END $$;
