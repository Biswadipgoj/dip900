# TelePoint EMI Portal

## Quick Start

```bash
npm install
cp .env.example .env.local
# Fill in Supabase keys in .env.local
npm run dev
```

Open http://localhost:3000

---

## Login Credentials

| Role        | Username    | Password          |
|-------------|-------------|-------------------|
| Super Admin | TELEPOINT   | TELEBISWAJITPOINT |
| Retailer    | (set in app) | (set in app)     |
| Customer    | Aadhaar + Mobile → /customer |

---

## Environment Variables (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## Database Setup

1. Open Supabase → SQL Editor
2. Paste **TELEPOINT_DATABASE_SETUP.sql** (separate file provided)
3. Click Run
4. Go to Authentication → Users → Add User:
   - Email: telepoint@admin.local
   - Password: TELEBISWAJITPOINT

---

## UPI Payment

UPI ID: **biswajit.khanra82@axl**
QR code is auto-generated in the payment modal for UPI payments.

---

## Receipt Generation

After every successful payment:
1. A receipt screen appears immediately
2. Option to share via WhatsApp (prefilled message)
3. Option to view/print full receipt (printable page)
4. Receipt URL: /receipt/[payment_request_id]

---

## Deploy to Vercel

```bash
vercel --prod
```
Set env vars in Vercel dashboard → Settings → Environment Variables.

---

## Import Old Google Sheet Data

If your old customer data has a text `retailer_name` field:
- The system matches by normalizing both names (lowercase, trim, collapse spaces)
- No re-import needed — works with existing data
- When creating new customers, both `retailer_id` and `retailer_name` are stored

---

Created by DIP
