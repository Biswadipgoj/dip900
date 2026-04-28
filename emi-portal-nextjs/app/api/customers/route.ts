import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function normalizeDigits(v: unknown) {
  return String(v || '').replace(/\D/g, '');
}

function validateCustomerInput(body: Record<string, unknown>) {
  const errors: Record<string, string> = {};

  const required = [
    'retailer_id', 'customer_name', 'aadhaar', 'address', 'mobile', 'model_no', 'imei', 'box_no',
    'purchase_value', 'purchase_date', 'emi_due_day', 'emi_amount', 'emi_tenure',
  ];

  for (const key of required) {
    if (!String(body[key] ?? '').trim()) errors[key] = `${key} is required`;
  }

  const imei = normalizeDigits(body.imei);
  if (imei.length !== 15) errors.imei = 'IMEI must be exactly 15 digits';
  const mobile = normalizeDigits(body.mobile);
  if (mobile.length !== 10) errors.mobile = 'Mobile must be exactly 10 digits';
  const aadhaar = normalizeDigits(body.aadhaar);
  if (aadhaar.length !== 12) errors.aadhaar = 'Aadhaar must be exactly 12 digits';

  return { errors, normalized: { imei, mobile, aadhaar } };
}

async function assertAdminOrRetailer() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (!profile || !['super_admin', 'retailer'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, role: profile.role as 'super_admin' | 'retailer' };
}

export async function POST(req: NextRequest) {
  const auth = await assertAdminOrRetailer();
  if (auth.error) return auth.error;

  const body = await req.json() as Record<string, unknown>;
  const { errors, normalized } = validateCustomerInput(body);
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });

  const service = createServiceClient();
  const { data: exists } = await service.from('customers').select('id').eq('imei', normalized.imei).maybeSingle();
  if (exists) return NextResponse.json({ error: 'This IMEI already exists in the system' }, { status: 409 });

  const payload = {
    ...body,
    imei: normalized.imei,
    mobile: normalized.mobile,
    aadhaar: normalized.aadhaar,
    alternate_number_1: normalizeDigits(body.alternate_number_1) || null,
    alternate_number_2: normalizeDigits(body.alternate_number_2) || null,
  };

  const { data, error } = await service.from('customers').insert(payload).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function PATCH(req: NextRequest) {
  const auth = await assertAdminOrRetailer();
  if (auth.error) return auth.error;

  const body = await req.json() as Record<string, unknown>;
  const customerId = String(body.id || '');
  if (!customerId) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { errors, normalized } = validateCustomerInput(body);
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });

  const service = createServiceClient();
  const { data: conflict } = await service.from('customers').select('id').eq('imei', normalized.imei).neq('id', customerId).maybeSingle();
  if (conflict) return NextResponse.json({ error: 'This IMEI already exists in the system' }, { status: 409 });

  const payload = {
    ...body,
    imei: normalized.imei,
    mobile: normalized.mobile,
    aadhaar: normalized.aadhaar,
    alternate_number_1: normalizeDigits(body.alternate_number_1) || null,
    alternate_number_2: normalizeDigits(body.alternate_number_2) || null,
  };
  delete (payload as Record<string, unknown>).id;

  const { error } = await service.from('customers').update(payload).eq('id', customerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
