-- ╔══════════════════════════════════════════════════════════════╗
-- ║  TELEPOINT EMI MANAGEMENT PORTAL                            ║
-- ║  COMPLETE SUPABASE SQL — FRESH INSTALL                      ║
-- ║                                                             ║
-- ║  Run this ONCE in Supabase → SQL Editor → Run               ║
-- ║  This creates EVERYTHING from scratch:                      ║
-- ║    • All tables with all columns                            ║
-- ║    • All functions (fine engine, EMI generation, etc.)       ║
-- ║    • All triggers                                           ║
-- ║    • All indexes                                            ║
-- ║    • All RLS policies                                       ║
-- ║    • Seed data (fine_settings, super admin)                 ║
-- ║    • Cron job (if pg_cron available)                        ║
-- ║                                                             ║
-- ║  Safe to run multiple times (fully idempotent)              ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ============================================================
-- STEP 1: EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- STEP 2: ALL TABLES (with every column the app needs)
-- ============================================================

-- ── 2.1 PROFILES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('super_admin', 'retailer')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.2 RETAILERS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retailers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  username     TEXT UNIQUE NOT NULL,
  retail_pin   TEXT,
  mobile       TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.3 CUSTOMERS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id              UUID NOT NULL REFERENCES retailers(id) ON DELETE RESTRICT,
  customer_name            TEXT NOT NULL,
  father_name              TEXT,
  aadhaar                  TEXT CHECK (aadhaar IS NULL OR LENGTH(aadhaar) = 12),
  voter_id                 TEXT,
  address                  TEXT,
  landmark                 TEXT,
  mobile                   TEXT NOT NULL CHECK (LENGTH(mobile) = 10),
  alternate_number_1       TEXT,
  alternate_number_2       TEXT,
  model_no                 TEXT,
  imei                     TEXT UNIQUE NOT NULL CHECK (LENGTH(imei) = 15),
  purchase_value           NUMERIC(12,2) NOT NULL,
  down_payment             NUMERIC(12,2) DEFAULT 0,
  disburse_amount          NUMERIC(12,2),
  purchase_date            DATE NOT NULL,
  emi_start_date           DATE,                -- Section 5: optional EMI start override
  emi_due_day              INT CHECK (emi_due_day BETWEEN 1 AND 28),
  emi_amount               NUMERIC(12,2) NOT NULL,
  emi_tenure               INT NOT NULL CHECK (emi_tenure BETWEEN 1 AND 12),
  first_emi_charge_amount  NUMERIC(12,2) DEFAULT 0,
  first_emi_charge_paid_at TIMESTAMPTZ,
  box_no                   TEXT,
  -- Image URLs (IBB hosted)
  customer_photo_url       TEXT,
  aadhaar_front_url        TEXT,
  aadhaar_back_url         TEXT,
  bill_photo_url           TEXT,
  emi_card_photo_url       TEXT,                -- Section 6: EMI card photo
  -- Legacy image columns (backwards compat)
  photo_url                TEXT,
  bill_url                 TEXT,
  card_url                 TEXT,
  -- Status
  status                   TEXT NOT NULL DEFAULT 'RUNNING'
                             CHECK (status IN ('RUNNING', 'COMPLETE', 'SETTLED', 'NPA')),
  completion_remark        TEXT,
  completion_date          DATE,
  -- Settlement
  settlement_amount        NUMERIC(12,2),
  settlement_date          DATE,
  -- Timestamps
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.4 EMI SCHEDULE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emi_schedule (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id            UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  emi_no                 INT NOT NULL,
  due_date               DATE NOT NULL,
  amount                 NUMERIC(12,2) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'UNPAID'
                           CHECK (status IN ('UNPAID', 'PENDING_APPROVAL', 'APPROVED')),
  paid_at                TIMESTAMPTZ,
  mode                   TEXT CHECK (mode IN ('CASH', 'UPI')),
  utr                    TEXT,                  -- Section 4: UTR stored per EMI
  approved_by            UUID REFERENCES auth.users(id),
  -- Fine fields (Section 2 & 3)
  fine_amount            NUMERIC(12,2) DEFAULT 0,
  fine_waived            BOOLEAN DEFAULT FALSE,
  fine_last_calculated_at TIMESTAMPTZ,          -- Section 2: when fine was last auto-calculated
  fine_paid_amount       NUMERIC(12,2) DEFAULT 0, -- Section 3: how much fine was actually paid
  fine_paid_at           TIMESTAMPTZ,            -- Section 3: when fine was paid
  -- Collection tracking
  collected_by_role      TEXT CHECK (collected_by_role IN ('admin', 'retailer')),
  collected_by_user_id   UUID REFERENCES auth.users(id),
  -- Timestamps
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, emi_no)
);

-- ── 2.5 PAYMENT REQUESTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_requests (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  retailer_id             UUID NOT NULL REFERENCES retailers(id),
  submitted_by            UUID REFERENCES auth.users(id),
  status                  TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  mode                    TEXT NOT NULL CHECK (mode IN ('CASH', 'UPI')),
  utr                     TEXT,                  -- Section 4: UTR stored on request
  total_emi_amount        NUMERIC(12,2) DEFAULT 0,
  scheduled_emi_amount    NUMERIC(12,2) DEFAULT 0,
  fine_amount             NUMERIC(12,2) DEFAULT 0,
  first_emi_charge_amount NUMERIC(12,2) DEFAULT 0,
  total_amount            NUMERIC(12,2) NOT NULL,
  receipt_url             TEXT,
  notes                   TEXT,
  selected_emi_nos        INT[],
  fine_for_emi_no         INT,
  fine_due_date           DATE,
  collected_by_role       TEXT CHECK (collected_by_role IN ('admin', 'retailer')),
  collected_by_user_id    UUID REFERENCES auth.users(id),
  approved_by             UUID REFERENCES auth.users(id),
  approved_at             TIMESTAMPTZ,
  rejected_by             UUID REFERENCES auth.users(id),
  rejected_at             TIMESTAMPTZ,
  rejection_reason        TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.6 PAYMENT REQUEST ITEMS ───────────────────────────────
-- CRITICAL: column is emi_schedule_id (NOT emi_id)
CREATE TABLE IF NOT EXISTS payment_request_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  emi_schedule_id    UUID NOT NULL REFERENCES emi_schedule(id),
  emi_no             INT NOT NULL,
  amount             NUMERIC(12,2) NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.7 AUDIT LOG ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES auth.users(id),
  actor_role    TEXT,
  action        TEXT NOT NULL,
  table_name    TEXT,
  record_id     UUID,
  before_data   JSONB,
  after_data    JSONB,
  remark        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.8 FINE SETTINGS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_settings (
  id                    INT PRIMARY KEY DEFAULT 1,
  default_fine_amount   NUMERIC(12,2) DEFAULT 450,
  weekly_fine_increment NUMERIC(12,2) DEFAULT 25,   -- Section 2: ₹25/week
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_by            UUID REFERENCES auth.users(id),
  CHECK (id = 1)
);

-- Seed fine settings (one row only)
INSERT INTO fine_settings (id, default_fine_amount, weekly_fine_increment)
VALUES (1, 450, 25)
ON CONFLICT (id) DO UPDATE SET
  default_fine_amount   = COALESCE(fine_settings.default_fine_amount, 450),
  weekly_fine_increment = COALESCE(fine_settings.weekly_fine_increment, 25);

-- ── 2.9 BROADCAST MESSAGES ──────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message            TEXT NOT NULL,
  image_url          TEXT,                        -- Section 7: broadcast image
  target_retailer_id UUID NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_by         UUID REFERENCES auth.users(id),
  sender_name        TEXT DEFAULT 'TELEPOINT',    -- Who sent it: "TELEPOINT" or retailer name
  sender_role        TEXT DEFAULT 'admin',         -- 'admin' or 'retailer'
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2.10 FINE HISTORY (audit trail for every fine event) ────
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


-- ============================================================
-- STEP 3: ALTER TABLE — add any missing columns
-- (safe on fresh DB — no errors if columns already exist)
-- ============================================================

ALTER TABLE retailers          ADD COLUMN IF NOT EXISTS retail_pin TEXT;
ALTER TABLE retailers          ADD COLUMN IF NOT EXISTS mobile TEXT;

ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS collected_by_role TEXT
  CHECK (collected_by_role IN ('admin', 'retailer'));
ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS collected_by_user_id UUID
  REFERENCES auth.users(id);
ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS fine_last_calculated_at TIMESTAMPTZ;
ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS fine_paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS fine_paid_at TIMESTAMPTZ;
ALTER TABLE emi_schedule       ADD COLUMN IF NOT EXISTS utr TEXT;

ALTER TABLE customers          ADD COLUMN IF NOT EXISTS customer_photo_url TEXT;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS aadhaar_front_url TEXT;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS aadhaar_back_url TEXT;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS bill_photo_url TEXT;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS emi_card_photo_url TEXT;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS emi_start_date DATE;
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12,2);
ALTER TABLE customers          ADD COLUMN IF NOT EXISTS settlement_date DATE;

ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS selected_emi_nos INT[];
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS scheduled_emi_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS collected_by_role TEXT
  CHECK (collected_by_role IN ('admin', 'retailer'));
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS collected_by_user_id UUID
  REFERENCES auth.users(id);
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS fine_for_emi_no INT;
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS fine_due_date DATE;
ALTER TABLE payment_requests   ADD COLUMN IF NOT EXISTS utr TEXT;

ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT 'TELEPOINT';
ALTER TABLE broadcast_messages ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'admin';

ALTER TABLE fine_settings      ADD COLUMN IF NOT EXISTS weekly_fine_increment NUMERIC(12,2) DEFAULT 25;

-- Fix customer status constraint (allow SETTLED, NPA)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('RUNNING', 'COMPLETE', 'SETTLED', 'NPA'));


-- ============================================================
-- STEP 4: ALL INDEXES
-- ============================================================

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_imei          ON customers(imei);
CREATE INDEX IF NOT EXISTS idx_customers_aadhaar       ON customers(aadhaar);
CREATE INDEX IF NOT EXISTS idx_customers_mobile        ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_retailer_id   ON customers(retailer_id);
CREATE INDEX IF NOT EXISTS idx_customers_status        ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_name          ON customers
  USING gin(to_tsvector('english', customer_name));

-- EMI Schedule
CREATE INDEX IF NOT EXISTS idx_emi_schedule_customer_id ON emi_schedule(customer_id);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_due_date    ON emi_schedule(due_date);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_status      ON emi_schedule(status);
CREATE INDEX IF NOT EXISTS idx_emi_schedule_utr         ON emi_schedule(utr);

-- Payment Requests
CREATE INDEX IF NOT EXISTS idx_payment_requests_customer_id ON payment_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_retailer_id ON payment_requests(retailer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status      ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at  ON payment_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_utr         ON payment_requests(utr);

-- Payment Request Items
CREATE INDEX IF NOT EXISTS idx_pri_payment_request_id   ON payment_request_items(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_pri_emi_schedule_id      ON payment_request_items(emi_schedule_id);

-- Broadcast Messages
CREATE INDEX IF NOT EXISTS idx_broadcast_retailer       ON broadcast_messages(target_retailer_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_expires        ON broadcast_messages(expires_at);

-- Fine History
CREATE INDEX IF NOT EXISTS idx_fine_history_customer    ON fine_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_fine_history_emi         ON fine_history(emi_schedule_id);
CREATE INDEX IF NOT EXISTS idx_fine_history_date        ON fine_history(fine_date);


-- ============================================================
-- STEP 5: HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_retailer_id()
RETURNS UUID AS $$
  SELECT id FROM retailers WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ============================================================
-- STEP 6: EMI SCHEDULE GENERATOR
-- Respects emi_start_date (Section 5)
-- ============================================================

CREATE OR REPLACE FUNCTION generate_emi_schedule(p_customer_id UUID)
RETURNS VOID AS $$
DECLARE
  v_customer   RECORD;
  v_start_date DATE;
  v_due_date   DATE;
  i            INT;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;

  -- Delete old schedule (will be regenerated)
  DELETE FROM emi_schedule WHERE customer_id = p_customer_id;

  -- Use emi_start_date if set, otherwise derive from purchase_date
  v_start_date := COALESCE(v_customer.emi_start_date, v_customer.purchase_date);

  FOR i IN 1..v_customer.emi_tenure LOOP
    v_due_date :=
      DATE_TRUNC('month', v_start_date + (i || ' months')::INTERVAL)
      + (v_customer.emi_due_day - 1) * INTERVAL '1 day';

    -- Clamp to end of month if emi_due_day > days in that month
    IF v_due_date > (
      DATE_TRUNC('month', v_start_date + (i || ' months')::INTERVAL)
      + INTERVAL '1 month - 1 day'
    ) THEN
      v_due_date :=
        DATE_TRUNC('month', v_start_date + (i || ' months')::INTERVAL)
        + INTERVAL '1 month - 1 day';
    END IF;

    INSERT INTO emi_schedule (customer_id, emi_no, due_date, amount)
    VALUES (p_customer_id, i, v_due_date, v_customer.emi_amount);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- STEP 7: EMI SCHEDULE TRIGGERS
-- Auto-generate on INSERT, regenerate on key field UPDATE
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_generate_emi_schedule()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM generate_emi_schedule(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_customer_insert ON customers;
CREATE TRIGGER after_customer_insert
  AFTER INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_generate_emi_schedule();

CREATE OR REPLACE FUNCTION trigger_regenerate_emi_on_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.emi_tenure    != NEW.emi_tenure    OR
     OLD.emi_amount    != NEW.emi_amount    OR
     OLD.purchase_date != NEW.purchase_date OR
     OLD.emi_due_day   != NEW.emi_due_day   OR
     COALESCE(OLD.emi_start_date::TEXT, '') != COALESCE(NEW.emi_start_date::TEXT, '')
  THEN
    PERFORM generate_emi_schedule(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_customer_update ON customers;
CREATE TRIGGER after_customer_update
  AFTER UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_regenerate_emi_on_update();


-- ============================================================
-- STEP 8: AUTOMATIC FINE ENGINE
--
-- FORMULA (with monthly reset):
--   Per 30-day cycle: base_fine + (4 × weekly_increment)
--   For N complete months: N × (base_fine + 4 × weekly_increment)
--   Partial month: base_fine + (weeks_in_partial × weekly_increment)
--
-- Example (base=450, weekly=25, per_month=550):
--   Day  1 →  450                Day 31 → 1000 (550 + 450)
--   Day  7 →  475                Day 37 → 1025 (550 + 475)
--   Day 14 →  500                Day 60 → 1100 (2 × 550)
--   Day 21 →  525                Day 61 → 1550 (1100 + 450)
--   Day 28 →  550                Day 90 → 1650 (3 × 550)
--
-- Runs: daily via pg_cron + on every get_due_breakdown() call
-- Logs every fine change to fine_history for audit trail
-- ============================================================

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
  -- Read settings from fine_settings table
  SELECT default_fine_amount, COALESCE(weekly_fine_increment, 25)
  INTO v_base_fine, v_weekly_increment
  FROM fine_settings WHERE id = 1;

  IF v_base_fine IS NULL THEN v_base_fine := 450; END IF;
  IF v_weekly_increment IS NULL THEN v_weekly_increment := 25; END IF;
  v_fine_per_month := v_base_fine + (4 * v_weekly_increment); -- 450 + 100 = 550

  -- Loop through ALL overdue UNPAID EMIs for RUNNING customers
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

    -- Monthly reset calculation
    v_completed_months := v_days_overdue / 30;    -- integer division
    v_remaining_days   := v_days_overdue % 30;

    -- Completed months: each 30-day cycle = fine_per_month
    v_calculated_fine := v_completed_months * v_fine_per_month;

    -- Partial current month: base fine + weekly escalation
    IF v_remaining_days > 0 THEN
      v_weeks_in_current := v_remaining_days / 7; -- integer division
      v_calculated_fine := v_calculated_fine + v_base_fine + (v_weeks_in_current * v_weekly_increment);
    END IF;

    v_old_fine := COALESCE(v_emi.fine_amount, 0);

    -- Only update if fine changed
    IF v_calculated_fine != v_old_fine THEN
      UPDATE emi_schedule
      SET fine_amount              = v_calculated_fine,
          fine_last_calculated_at  = NOW(),
          updated_at               = NOW()
      WHERE id = v_emi.id;

      -- Log to fine_history for audit trail
      INSERT INTO fine_history (customer_id, emi_schedule_id, emi_no, fine_type, fine_amount, cumulative_fine, fine_date, reason)
      VALUES (
        v_emi.customer_id,
        v_emi.id,
        v_emi.emi_no,
        CASE
          WHEN v_old_fine = 0 THEN 'BASE'
          WHEN v_completed_months > 0 AND v_remaining_days <= 1 THEN 'MONTHLY_RESET'
          ELSE 'WEEKLY'
        END,
        v_calculated_fine - v_old_fine,   -- incremental amount
        v_calculated_fine,                 -- cumulative total
        CURRENT_DATE,
        'Auto: ' || v_days_overdue || ' days overdue, '
          || v_completed_months || ' month(s) + '
          || v_remaining_days || ' day(s). Fine: '
          || v_old_fine || ' → ' || v_calculated_fine
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- STEP 9: get_due_breakdown()
-- Returns JSON with next EMI, fine, first charge, total payable
-- Called by: admin page, retailer page, customer portal
-- Triggers fine recalculation on every call
-- ============================================================

CREATE OR REPLACE FUNCTION get_due_breakdown(
  p_customer_id     UUID,
  p_selected_emi_no INT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_customer             RECORD;
  v_next_emi             RECORD;
  v_selected_emi         RECORD;
  v_fine_due             NUMERIC := 0;
  v_first_emi_charge_due NUMERIC := 0;
  v_emi_amount           NUMERIC := 0;
  v_total_payable        NUMERIC := 0;
  v_popup_first_charge   BOOLEAN := FALSE;
  v_popup_fine           BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RETURN '{"error": "Customer not found"}'::JSONB;
  END IF;

  -- Recalculate fines for ALL overdue EMIs (writes to emi_schedule.fine_amount)
  PERFORM calculate_and_apply_fines();

  -- Get the lowest unpaid EMI (next due)
  SELECT * INTO v_next_emi
  FROM emi_schedule
  WHERE customer_id = p_customer_id AND status = 'UNPAID'
  ORDER BY emi_no ASC LIMIT 1;

  -- Determine EMI amount (selected or next)
  IF p_selected_emi_no IS NOT NULL THEN
    SELECT * INTO v_selected_emi
    FROM emi_schedule
    WHERE customer_id = p_customer_id
      AND emi_no = p_selected_emi_no
      AND status = 'UNPAID';
    IF FOUND THEN
      v_emi_amount := v_selected_emi.amount;
    END IF;
  ELSE
    v_emi_amount := COALESCE(v_next_emi.amount, 0);
  END IF;

  -- Total fine = SUM of ALL overdue EMI fines minus already-paid amounts
  SELECT COALESCE(SUM(
    GREATEST(0, COALESCE(fine_amount, 0) - COALESCE(fine_paid_amount, 0))
  ), 0) INTO v_fine_due
  FROM emi_schedule
  WHERE customer_id = p_customer_id
    AND status = 'UNPAID'
    AND due_date < CURRENT_DATE
    AND fine_waived = FALSE;

  IF v_fine_due > 0 THEN v_popup_fine := TRUE; END IF;

  -- First EMI charge (one-time fee)
  IF v_customer.first_emi_charge_amount > 0
     AND v_customer.first_emi_charge_paid_at IS NULL THEN
    v_first_emi_charge_due := v_customer.first_emi_charge_amount;
    v_popup_first_charge   := TRUE;
  END IF;

  v_total_payable := v_emi_amount + v_fine_due + v_first_emi_charge_due;

  RETURN jsonb_build_object(
    'customer_id',            p_customer_id,
    'customer_status',        v_customer.status,
    'next_emi_no',            v_next_emi.emi_no,
    'next_emi_amount',        v_next_emi.amount,
    'next_emi_due_date',      v_next_emi.due_date,
    'next_emi_status',        v_next_emi.status,
    'selected_emi_no',        COALESCE(p_selected_emi_no, v_next_emi.emi_no),
    'selected_emi_amount',    v_emi_amount,
    'fine_due',               v_fine_due,
    'first_emi_charge_due',   v_first_emi_charge_due,
    'total_payable',          v_total_payable,
    'popup_first_emi_charge', v_popup_first_charge,
    'popup_fine_due',         v_popup_fine,
    'is_overdue',             (v_next_emi IS NOT NULL AND CURRENT_DATE > v_next_emi.due_date)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- STEP 10: ATOMIC APPROVAL STORED PROCEDURE
-- Called via: supabase.rpc('approve_payment_request', {...})
-- Runs entire approval in a single transaction with row locking
-- ============================================================

CREATE OR REPLACE FUNCTION approve_payment_request(
  p_request_id UUID,
  p_admin_id   UUID,
  p_remark     TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_request      RECORD;
  v_item         RECORD;
  v_now          TIMESTAMPTZ := NOW();
  v_emi_ids      UUID[]      := '{}'::UUID[];
  v_unpaid_count INT;
  v_utr          TEXT;
BEGIN
  -- Lock row to prevent double-approval race condition
  SELECT * INTO v_request
  FROM payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- Idempotency: already approved → return success
  IF v_request.status = 'APPROVED' THEN
    RETURN jsonb_build_object('success', true, 'already_approved', true);
  END IF;

  IF v_request.status != 'PENDING' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot approve: status is ' || v_request.status
    );
  END IF;

  -- Get UTR from request
  v_utr := v_request.utr;

  -- STEP 1: Mark all linked EMIs as APPROVED
  FOR v_item IN
    SELECT pri.emi_schedule_id, pri.emi_no
    FROM payment_request_items pri
    WHERE pri.payment_request_id = p_request_id
  LOOP
    UPDATE emi_schedule
    SET
      status               = 'APPROVED',
      paid_at              = v_now,
      mode                 = v_request.mode,
      utr                  = v_utr,
      approved_by          = p_admin_id,
      collected_by_role    = 'retailer',
      collected_by_user_id = v_request.submitted_by
    WHERE id = v_item.emi_schedule_id;

    v_emi_ids := v_emi_ids || v_item.emi_schedule_id;
  END LOOP;

  -- STEP 2: Record fine payment on the lowest EMI
  IF v_request.fine_amount > 0 THEN
    UPDATE emi_schedule
    SET fine_paid_amount = v_request.fine_amount,
        fine_paid_at     = v_now
    WHERE customer_id = v_request.customer_id
      AND emi_no = (
        SELECT MIN(pri.emi_no)
        FROM payment_request_items pri
        WHERE pri.payment_request_id = p_request_id
      );
  END IF;

  -- STEP 3: Mark first EMI charge paid (idempotent)
  IF v_request.first_emi_charge_amount > 0 THEN
    UPDATE customers
    SET first_emi_charge_paid_at = v_now
    WHERE id = v_request.customer_id
      AND first_emi_charge_paid_at IS NULL;
  END IF;

  -- STEP 4: Update payment_request status
  UPDATE payment_requests
  SET
    status      = 'APPROVED',
    approved_by = p_admin_id,
    approved_at = v_now,
    notes       = CASE
                    WHEN p_remark IS NOT NULL
                    THEN COALESCE(notes || E'\n', '') || 'Admin remark: ' || p_remark
                    ELSE notes
                  END
  WHERE id = p_request_id;

  -- STEP 5: Auto-complete customer if all EMIs now paid
  SELECT COUNT(*) INTO v_unpaid_count
  FROM emi_schedule
  WHERE customer_id = v_request.customer_id
    AND status IN ('UNPAID', 'PENDING_APPROVAL');

  IF v_unpaid_count = 0 THEN
    UPDATE customers
    SET status          = 'COMPLETE',
        completion_date = v_now::DATE
    WHERE id     = v_request.customer_id
      AND status = 'RUNNING';
  END IF;

  -- STEP 6: Audit log
  INSERT INTO audit_log (
    actor_user_id, actor_role, action,
    table_name, record_id,
    before_data, after_data, remark
  ) VALUES (
    p_admin_id, 'super_admin', 'APPROVE_PAYMENT',
    'payment_requests', p_request_id,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object(
      'status',      'APPROVED',
      'emi_ids',     to_jsonb(v_emi_ids),
      'approved_at', v_now
    ),
    p_remark
  );

  RETURN jsonb_build_object(
    'success',     true,
    'request_id',  p_request_id,
    'emi_ids',     to_jsonb(v_emi_ids),
    'approved_at', v_now
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- STEP 11: SAFETY TRIGGER
-- Even if the API route partially fails, this trigger
-- guarantees EMIs are marked APPROVED when
-- payment_requests.status flips to APPROVED.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_auto_apply_payment_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_now  TIMESTAMPTZ := NOW();
BEGIN
  IF OLD.status = 'PENDING' AND NEW.status = 'APPROVED' THEN

    -- Mark all linked EMIs APPROVED
    FOR v_item IN
      SELECT emi_schedule_id
      FROM payment_request_items
      WHERE payment_request_id = NEW.id
    LOOP
      UPDATE emi_schedule
      SET
        status            = 'APPROVED',
        paid_at           = COALESCE(paid_at, v_now),
        mode              = COALESCE(mode, NEW.mode),
        utr               = COALESCE(utr, NEW.utr),
        approved_by       = COALESCE(approved_by, NEW.approved_by),
        collected_by_role = COALESCE(collected_by_role, 'retailer')
      WHERE id     = v_item.emi_schedule_id
        AND status != 'APPROVED';
    END LOOP;

    -- First EMI charge
    IF NEW.first_emi_charge_amount > 0 THEN
      UPDATE customers
      SET first_emi_charge_paid_at = COALESCE(first_emi_charge_paid_at, v_now)
      WHERE id                       = NEW.customer_id
        AND first_emi_charge_paid_at IS NULL;
    END IF;

    -- Record fine payment
    IF NEW.fine_amount > 0 THEN
      UPDATE emi_schedule
      SET fine_paid_amount = NEW.fine_amount,
          fine_paid_at     = v_now
      WHERE customer_id = NEW.customer_id
        AND status      = 'APPROVED'
        AND emi_no      = (
          SELECT MIN(pri.emi_no)
          FROM payment_request_items pri
          WHERE pri.payment_request_id = NEW.id
        );
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_apply_payment_on_approval ON payment_requests;
CREATE TRIGGER trg_auto_apply_payment_on_approval
  AFTER UPDATE OF status ON payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_apply_payment_on_approval();


-- ============================================================
-- STEP 12: DATA REPAIR
-- Back-fills payment_request_items for any existing PENDING
-- requests that were created without items
-- ============================================================

INSERT INTO payment_request_items (payment_request_id, emi_schedule_id, emi_no, amount)
SELECT
  pr.id AS payment_request_id,
  es.id AS emi_schedule_id,
  es.emi_no,
  pr.total_emi_amount / GREATEST(array_length(pr.selected_emi_nos, 1), 1) AS amount
FROM payment_requests pr
JOIN LATERAL UNNEST(pr.selected_emi_nos) AS sn(emi_no) ON TRUE
JOIN emi_schedule es
  ON es.customer_id = pr.customer_id
 AND es.emi_no      = sn.emi_no
WHERE pr.selected_emi_nos IS NOT NULL
  AND array_length(pr.selected_emi_nos, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM payment_request_items pri
    WHERE pri.payment_request_id = pr.id
  )
ON CONFLICT DO NOTHING;


-- ============================================================
-- STEP 13: ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_schedule          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_messages    ENABLE ROW LEVEL SECURITY;

-- Fine History
ALTER TABLE fine_history          ENABLE ROW LEVEL SECURITY;

-- ── Drop all existing policies (safe re-run) ────────────────
DROP POLICY IF EXISTS "profiles_self"                ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all"           ON profiles;
DROP POLICY IF EXISTS "retailers_admin_all"          ON retailers;
DROP POLICY IF EXISTS "retailers_self_read"          ON retailers;
DROP POLICY IF EXISTS "customers_admin_all"          ON customers;
DROP POLICY IF EXISTS "customers_retailer_own"       ON customers;
DROP POLICY IF EXISTS "emi_admin_all"                ON emi_schedule;
DROP POLICY IF EXISTS "emi_retailer_own"             ON emi_schedule;
DROP POLICY IF EXISTS "payment_requests_admin_all"   ON payment_requests;
DROP POLICY IF EXISTS "payment_requests_retailer_own" ON payment_requests;
DROP POLICY IF EXISTS "payment_requests_retailer_insert" ON payment_requests;
DROP POLICY IF EXISTS "payment_items_admin"          ON payment_request_items;
DROP POLICY IF EXISTS "payment_items_retailer"       ON payment_request_items;
DROP POLICY IF EXISTS "payment_items_retailer_insert" ON payment_request_items;
DROP POLICY IF EXISTS "audit_admin_read"             ON audit_log;
DROP POLICY IF EXISTS "audit_admin_insert"           ON audit_log;
DROP POLICY IF EXISTS "fine_settings_admin"          ON fine_settings;
DROP POLICY IF EXISTS "fine_settings_read"           ON fine_settings;
DROP POLICY IF EXISTS "broadcast_admin_all"          ON broadcast_messages;
DROP POLICY IF EXISTS "broadcast_retailer_read"      ON broadcast_messages;
DROP POLICY IF EXISTS "broadcast_retailer_insert"    ON broadcast_messages;

-- ── PROFILES ────────────────────────────────────────────────
CREATE POLICY "profiles_self"      ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL    USING (get_my_role() = 'super_admin');

-- ── RETAILERS ───────────────────────────────────────────────
CREATE POLICY "retailers_admin_all"  ON retailers FOR ALL    USING (get_my_role() = 'super_admin');
CREATE POLICY "retailers_self_read"  ON retailers FOR SELECT USING (auth_user_id = auth.uid());

-- ── CUSTOMERS ───────────────────────────────────────────────
CREATE POLICY "customers_admin_all"    ON customers FOR ALL    USING (get_my_role() = 'super_admin');
CREATE POLICY "customers_retailer_own" ON customers FOR SELECT USING (
  get_my_role() = 'retailer' AND retailer_id = get_my_retailer_id()
);

-- ── EMI SCHEDULE ────────────────────────────────────────────
CREATE POLICY "emi_admin_all"    ON emi_schedule FOR ALL    USING (get_my_role() = 'super_admin');
CREATE POLICY "emi_retailer_own" ON emi_schedule FOR SELECT USING (
  get_my_role() = 'retailer' AND
  customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id())
);

-- ── PAYMENT REQUESTS ────────────────────────────────────────
CREATE POLICY "payment_requests_admin_all" ON payment_requests FOR ALL USING (
  get_my_role() = 'super_admin'
);
CREATE POLICY "payment_requests_retailer_own" ON payment_requests FOR SELECT USING (
  get_my_role() = 'retailer' AND retailer_id = get_my_retailer_id()
);
-- Retailers can INSERT payment requests for their own customers
CREATE POLICY "payment_requests_retailer_insert" ON payment_requests FOR INSERT WITH CHECK (
  get_my_role() = 'retailer' AND retailer_id = get_my_retailer_id()
);

-- ── PAYMENT REQUEST ITEMS ───────────────────────────────────
CREATE POLICY "payment_items_admin" ON payment_request_items FOR ALL USING (
  get_my_role() = 'super_admin'
);
CREATE POLICY "payment_items_retailer" ON payment_request_items FOR SELECT USING (
  get_my_role() = 'retailer' AND
  payment_request_id IN (
    SELECT id FROM payment_requests WHERE retailer_id = get_my_retailer_id()
  )
);
-- Retailers can INSERT items for their own requests
CREATE POLICY "payment_items_retailer_insert" ON payment_request_items FOR INSERT WITH CHECK (
  get_my_role() = 'retailer' AND
  payment_request_id IN (
    SELECT id FROM payment_requests WHERE retailer_id = get_my_retailer_id()
  )
);

-- ── AUDIT LOG ───────────────────────────────────────────────
CREATE POLICY "audit_admin_read"   ON audit_log FOR SELECT USING (get_my_role() = 'super_admin');
CREATE POLICY "audit_admin_insert" ON audit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── FINE SETTINGS ───────────────────────────────────────────
CREATE POLICY "fine_settings_admin" ON fine_settings FOR ALL    USING (get_my_role() = 'super_admin');
CREATE POLICY "fine_settings_read"  ON fine_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── BROADCAST MESSAGES ──────────────────────────────────────
-- Admin can do everything
CREATE POLICY "broadcast_admin_all" ON broadcast_messages
  FOR ALL USING (get_my_role() = 'super_admin');
-- Retailers can read broadcasts targeting them
CREATE POLICY "broadcast_retailer_read" ON broadcast_messages
  FOR SELECT USING (
    get_my_role() = 'retailer' AND target_retailer_id = get_my_retailer_id()
  );
-- Retailers can INSERT broadcasts for their own customers (Section 7)
CREATE POLICY "broadcast_retailer_insert" ON broadcast_messages
  FOR INSERT WITH CHECK (
    get_my_role() = 'retailer' AND target_retailer_id = get_my_retailer_id()
  );

-- ── FINE HISTORY ────────────────────────────────────────────
DROP POLICY IF EXISTS "fine_history_admin_all"  ON fine_history;
DROP POLICY IF EXISTS "fine_history_retailer"   ON fine_history;
DROP POLICY IF EXISTS "fine_history_insert"     ON fine_history;

CREATE POLICY "fine_history_admin_all" ON fine_history FOR ALL USING (get_my_role() = 'super_admin');
CREATE POLICY "fine_history_retailer" ON fine_history FOR SELECT USING (
  get_my_role() = 'retailer' AND
  customer_id IN (SELECT id FROM customers WHERE retailer_id = get_my_retailer_id())
);
-- Service role inserts (from calculate_and_apply_fines)
CREATE POLICY "fine_history_insert" ON fine_history FOR INSERT WITH CHECK (TRUE);


-- ============================================================
-- STEP 14: GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION get_my_role()                              TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_retailer_id()                       TO authenticated;
GRANT EXECUTE ON FUNCTION get_due_breakdown(UUID, INT)               TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_and_apply_fines()                TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_and_apply_fines()                TO service_role;
GRANT EXECUTE ON FUNCTION approve_payment_request(UUID, UUID, TEXT)  TO service_role;


-- ============================================================
-- STEP 15: SEED SUPER ADMIN PROFILE
-- This links the first admin user (telepoint@admin.local) as super_admin.
--
-- ⚠️  IMPORTANT: Before running this, create your admin user:
--     1. Go to Supabase → Authentication → Users → Add User
--     2. Email:    telepoint@admin.local
--     3. Password: your-secure-password
--     4. Check "Auto Confirm User"
--     5. Click "Create User"
--     6. Then run this SQL
-- ============================================================

INSERT INTO profiles (user_id, role)
SELECT id, 'super_admin'
FROM auth.users
WHERE email = 'telepoint@admin.local'
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';


-- ============================================================
-- STEP 16: RUN FINE ENGINE (backfill existing data)
-- ============================================================

SELECT * FROM calculate_and_apply_fines();


-- ============================================================
-- STEP 17: DAILY CRON JOB (auto-calculate fines at midnight)
-- Only works if pg_cron extension is enabled in Supabase
-- (Supabase Pro plan and above)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old job if exists
    BEGIN
      PERFORM cron.unschedule('calculate-fines-daily');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- ignore if job doesn't exist
    END;

    PERFORM cron.schedule(
      'calculate-fines-daily',
      '0 0 * * *',              -- midnight every day
      'SELECT calculate_and_apply_fines()'
    );
    RAISE NOTICE 'pg_cron job scheduled: calculate-fines-daily (midnight daily)';
  ELSE
    RAISE NOTICE 'pg_cron not available. Fines auto-calculate on every get_due_breakdown() call.';
  END IF;
END $$;


-- ============================================================
-- STEP 18: RELOAD POSTGREST SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- ✅ DONE — VERIFICATION SUMMARY
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ TELEPOINT EMI PORTAL — SQL SETUP COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  TABLES CREATED:';
  RAISE NOTICE '    ✓ profiles';
  RAISE NOTICE '    ✓ retailers';
  RAISE NOTICE '    ✓ customers              (with emi_start_date, emi_card_photo_url)';
  RAISE NOTICE '    ✓ emi_schedule           (with fine engine, UTR, fine_paid_amount)';
  RAISE NOTICE '    ✓ payment_requests       (with UTR column)';
  RAISE NOTICE '    ✓ payment_request_items';
  RAISE NOTICE '    ✓ audit_log';
  RAISE NOTICE '    ✓ fine_settings          (with weekly_fine_increment)';
  RAISE NOTICE '    ✓ broadcast_messages     (with image_url, sender_name)';
  RAISE NOTICE '    ✓ fine_history           (audit trail for every fine event)';
  RAISE NOTICE '';
  RAISE NOTICE '  FUNCTIONS:';
  RAISE NOTICE '    ✓ get_my_role()';
  RAISE NOTICE '    ✓ get_my_retailer_id()';
  RAISE NOTICE '    ✓ generate_emi_schedule()         — respects emi_start_date';
  RAISE NOTICE '    ✓ calculate_and_apply_fines()     — auto fine engine';
  RAISE NOTICE '    ✓ get_due_breakdown()             — includes fine from DB';
  RAISE NOTICE '    ✓ approve_payment_request()       — atomic RPC approval';
  RAISE NOTICE '';
  RAISE NOTICE '  TRIGGERS:';
  RAISE NOTICE '    ✓ after_customer_insert            → auto EMI generation';
  RAISE NOTICE '    ✓ after_customer_update            → EMI regeneration on changes';
  RAISE NOTICE '    ✓ trg_auto_apply_payment_on_approval → safety net';
  RAISE NOTICE '';
  RAISE NOTICE '  RLS POLICIES: All tables secured';
  RAISE NOTICE '  INDEXES: All search fields indexed (IMEI, mobile, UTR, etc.)';
  RAISE NOTICE '';
  RAISE NOTICE '  ⚠️  NEXT STEPS:';
  RAISE NOTICE '    1. Create admin user: telepoint@admin.local in Auth → Users';
  RAISE NOTICE '    2. Set NEXT_PUBLIC_SUPABASE_URL in Vercel env vars';
  RAISE NOTICE '    3. Set NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel env vars';
  RAISE NOTICE '    4. Set SUPABASE_SERVICE_ROLE_KEY in Vercel env vars';
  RAISE NOTICE '    5. Deploy to Vercel';
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;
