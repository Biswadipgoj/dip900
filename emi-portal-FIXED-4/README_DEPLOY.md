# EMI Portal — Deployment Guide v2

## Overview

Next.js 14 + Supabase EMI management portal for TelePoint, deployed on Vercel.

---

## 1. Environment Variables (Vercel)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** service role key — never expose in frontend |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL (e.g. `https://emi-portal.vercel.app`) |

---

## 2. Supabase Setup

### Run Migration SQL
1. Supabase Dashboard → SQL Editor
2. Paste and run **`supabase_migration.sql`**
3. This is idempotent (safe to run multiple times)

### Create Admin User
1. Supabase → Authentication → Add User (email + password)
2. Run SQL to assign admin role:
```sql
INSERT INTO profiles (user_id, role)
VALUES ('<UUID_FROM_AUTH>', 'super_admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';
```

### Create Retailers
Admin panel → Retailers tab → Add Retailer
(fills username, password, retail PIN, mobile)

---

## 3. Deploy

```bash
npm install
npm run build   # verify build passes
npx vercel --prod
```

---

## 4. Feature Guide

| Feature | Details |
|---|---|
| Receipt Download | `GET /api/receipt/[id]` — server HTML, works on mobile |
| NOC/Bill | Admin only, COMPLETE customers only |
| Excel Export | `GET /api/export?type=all|running|complete` — server .xlsx |
| Customer Portal | `/customer` — login by Aadhaar or Mobile |
| Payment Collection | Retailer → PENDING_APPROVAL; Admin → instant APPROVED |
| Editable amounts | Retailer/Admin can enter actual collected amount (partial/extra) |
| CSV Import | Admin → Import CSV tab |
| Upcoming EMI | Retailer dashboard: next 5 days panel |

---

## 5. Access Control

| Feature | Admin | Retailer | Customer |
|---|:---:|:---:|:---:|
| All customers | ✅ | own only | ❌ |
| Direct payment (auto-approved) | ✅ | ❌ | ❌ |
| Submit payment (pending) | ✅ | ✅ | ❌ |
| Approve/Reject payments | ✅ | ❌ | ❌ |
| NOC/Bill | ✅ (COMPLETE only) | ❌ | ❌ |
| Excel export | all | own | ❌ |
| CSV Import | ✅ | ❌ | ❌ |
| Manage retailers | ✅ | ❌ | ❌ |

---

## 6. File Change Log (v2)

| File | Change |
|---|---|
| `components/CustomerDetailPanel.tsx` | NOC/Bill only shows for COMPLETE status |
| `components/PaymentModal.tsx` | Editable collected amounts + fine metadata fields |
| `components/CustomerFormModal.tsx` | father_name now required |
| `app/api/receipt/[id]/route.ts` | Simplified: photo, retailer, amounts, next EMI due |
| `app/api/payments/submit/route.ts` | Stores fine_for_emi_no, fine_due_date, scheduled_emi_amount, collected_by_* |
| `app/api/payments/approve-direct/route.ts` | Same new fields |
| `app/api/export/route.ts` | NEW — server-side Excel export (Running/Complete/All) |
| `app/admin/page.tsx` | Excel export buttons in Reports section |
| `app/retailer/page.tsx` | Running/Complete download links |
| `package.json` | Added xlsx dependency |
| `supabase_migration.sql` | Full migration: columns, RLS, get_due_breakdown() |
