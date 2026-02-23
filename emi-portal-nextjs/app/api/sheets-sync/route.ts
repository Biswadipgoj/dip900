/**
 * /api/sheets-sync
 *
 * Server-to-server call to the Google Apps Script Web App.
 * Token is kept server-side — never exposed to the browser.
 *
 * Called after:
 *   - Customer create / update
 *   - Payment applied (direct or approved)
 *   - Settlement completed
 *   - CSV import
 *
 * ENV VARS required in Vercel:
 *   SHEET_SYNC_URL   = https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
 *   SHEET_SYNC_TOKEN = dip2001
 */
import { NextRequest, NextResponse } from 'next/server';

const SHEET_URL   = process.env.SHEET_SYNC_URL   || '';
const SHEET_TOKEN = process.env.SHEET_SYNC_TOKEN  || 'dip2001';

// Map Supabase/Next.js field names → Google Sheet canonical column names
function toSheetRow(customer: Record<string, unknown>): Record<string, unknown> {
  return {
    'IMEI NO'          : customer.imei               ?? '',
    'CUSTOMER NAME'    : customer.customer_name       ?? '',
    'FATHER NAME'      : customer.father_name         ?? '',
    'MOBILE NO'        : customer.mobile              ?? '',
    'ALTARNET NUMBER'  : customer.alternate_number_1  ?? '',
    'AADHAR NO'        : customer.aadhaar             ?? '',
    'VOTER ID'         : customer.voter_id            ?? '',
    'ADDRESS'          : customer.address             ?? '',
    'RETAIL NAME'      : customer.retailer_name ?? (customer.retailer as Record<string, unknown>)?.name ?? '',
    'MODEL NO'         : customer.model_no            ?? '',
    'BOX NO'           : customer.box_no              ?? '',
    'PURCHASE VALUE'   : customer.purchase_value      ?? '',
    'DOWN PAYMENT'     : customer.down_payment        ?? '',
    'DISBURSE AMOUNT'  : customer.disburse_amount     ?? '',
    'PURCHASE DATE'    : customer.purchase_date       ?? '',
    'EMI AMOUNT'       : customer.emi_amount          ?? '',
    'EMI TENURE'       : customer.emi_tenure          ?? '',
    'EMI DUE DAY'      : customer.emi_due_day         ?? '',
    'FIRST EMI CHARGE' : customer.first_emi_charge_amount ?? '',
    'PAID COUNT'       : customer.paid_count          ?? 0,
    'TOTAL PAID'       : customer.total_paid          ?? 0,
    'FINE DUE'         : customer.fine_due            ?? 0,
    'LAST PAYMENT DATE': customer.last_payment_date   ?? '',
    'STATUS'           : customer.status              ?? 'RUNNING',
    'COMPLETION DATE'  : customer.completion_date     ?? '',
    'COMPLETION REMARK': customer.completion_remark   ?? '',
    'CUSTOMAR IMAGE'   : customer.customer_photo_url  ?? '',
    'AADHAR FONT'      : customer.aadhaar_front_url   ?? '',
    'AADHAR BACK'      : customer.aadhaar_back_url    ?? '',
    'BILL'             : customer.bill_photo_url      ?? '',
    'REMARKS'          : customer.notes               ?? '',
  };
}

async function callSheets(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!SHEET_URL) {
    console.warn('[sheets-sync] SHEET_SYNC_URL not set — skipping sync');
    return { ok: true };
  }

  try {
    const res = await fetch(SHEET_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ token: SHEET_TOKEN, ...body }),
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }

    if (!res.ok || json.ok === false) {
      console.error('[sheets-sync] Sheets error:', json);
      return { ok: false, error: (json.error as string) || `HTTP ${res.status}` };
    }

    console.log('[sheets-sync] OK', json);
    return { ok: true };
  } catch (err) {
    console.error('[sheets-sync] Network error:', err);
    return { ok: false, error: String(err) };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action   : 'upsert' | 'bulkUpsert' | 'delete' | 'read';
    customer?: Record<string, unknown>;
    customers?: Record<string, unknown>[];
    imei?    : string;
  };

  let result: { ok: boolean; error?: string };

  switch (body.action) {
    case 'upsert':
      if (!body.customer) return NextResponse.json({ error: 'customer required' }, { status: 400 });
      result = await callSheets({ action: 'upsert', data: toSheetRow(body.customer) });
      break;

    case 'bulkUpsert':
      if (!body.customers?.length) return NextResponse.json({ error: 'customers array required' }, { status: 400 });
      result = await callSheets({ action: 'bulkUpsert', data: body.customers.map(toSheetRow) });
      break;

    case 'delete':
      if (!body.imei) return NextResponse.json({ error: 'imei required' }, { status: 400 });
      result = await callSheets({ action: 'delete', imei: body.imei });
      break;

    case 'read':
      result = await callSheets({ action: 'read' });
      break;

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/**
 * Helper: call this from any server route after a customer change.
 *
 * Usage:
 *   import { syncCustomerToSheet } from '@/app/api/sheets-sync/route';
 *   await syncCustomerToSheet(customerObject);
 */
export async function syncCustomerToSheet(customer: Record<string, unknown>) {
  return callSheets({ action: 'upsert', data: toSheetRow(customer) });
}
