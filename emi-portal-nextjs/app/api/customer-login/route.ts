import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { aadhaar, mobile } = body;

  if (!aadhaar || aadhaar.length !== 12) {
    return NextResponse.json({ error: 'Aadhaar must be exactly 12 digits' }, { status: 400 });
  }
  if (!mobile || mobile.length !== 10) {
    return NextResponse.json({ error: 'Mobile must be exactly 10 digits' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Both aadhaar AND mobile must match the same record — server-side only
  const { data: customer, error } = await serviceClient
    .from('customers')
    .select(`
      id, customer_name, father_name, aadhaar, mobile,
      alternate_number_1, alternate_number_2,
      model_no, imei, purchase_value, down_payment, disburse_amount,
      purchase_date, emi_due_day, emi_amount, emi_tenure,
      first_emi_charge_amount, first_emi_charge_paid_at,
      customer_photo_url, status,
      retailer:retailers(name)
    `)
    .eq('aadhaar', aadhaar)
    .eq('mobile', mobile)
    .eq('status', 'RUNNING')
    .single();

  if (error || !customer) {
    return NextResponse.json(
      { error: 'No matching customer found. Check your Aadhaar and Mobile number.' },
      { status: 401 }
    );
  }

  // Fetch EMI schedule separately (don't expose via RLS since customer has no auth session)
  const { data: emis } = await serviceClient
    .from('emi_schedule')
    .select('id, emi_no, due_date, amount, status, paid_at, mode, fine_amount, fine_waived')
    .eq('customer_id', customer.id)
    .order('emi_no');

  // Get due breakdown
  const { data: breakdown } = await serviceClient.rpc('get_due_breakdown', {
    p_customer_id: customer.id,
  });

  // Return customer data + EMIs + breakdown — no auth token issued
  return NextResponse.json({
    customer,
    emis: emis || [],
    breakdown,
  });
}
