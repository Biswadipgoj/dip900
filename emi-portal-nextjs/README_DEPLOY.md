# EMI Portal Deployment Notes (Vercel + Supabase)

## Environment variables (Vercel)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## SQL to run
1. Run baseline migrations in order from `migrations/001_initial.sql` to `migrations/003_payment_approval_fix.sql`.
2. Run `supabase_migration.sql` for idempotent production patches (retailer mobile/pin hash, settlement support, payment compatibility columns).

## Admin bootstrap
1. Create an auth user in Supabase Auth dashboard.
2. Insert profile role mapping:
   ```sql
   insert into profiles (user_id, role)
   values ('<auth_user_uuid>', 'super_admin')
   on conflict (user_id) do update set role = excluded.role;
   ```
3. Login from `/login` using the created credentials.

## File-by-file change log (this update)
- `app/api/receipt/[payment_id]/route.ts`: receipt payload trimmed and attachment response preserved; added retailer mobile + rejected status label.
- `app/api/customer-login/route.ts`: Aadhaar/mobile login logic hardened; multi-match mobile returns explicit error.
- `app/api/customers/route.ts`: centralized server-side customer create/update validation + IMEI uniqueness guard.
- `components/CustomerFormModal.tsx`: customer writes moved from direct client DB calls to secured API route.
- `app/customer/page.tsx`: customer session persistence via localStorage, due-in-5-days alert popup, explicit logout cleanup.
- `app/api/retailers/route.ts`: retailer mobile normalized and validated to 10 digits on create/update.
- `components/CustomerDetailPanel.tsx`: NOC/Bill links now hidden for RUNNING customers.
- `supabase_migration.sql`: added payment-request compatibility columns for mixed collection records.

## Pages/flows tested
- Admin build pipeline (`npm run build`) up to prerender stage.
- Customer login API (aadhaar/mobile and duplicate-mobile branch).
- Customer create/update API validation wiring from modal.
- Receipt download endpoint response headers/HTML rendering.
