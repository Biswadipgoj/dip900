import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { aadhaar, mobile } = body;

  const cleanAadhaar = (aadhaar || '').replace(/\D/g, '');
  const cleanMobile = (mobile || '').replace(/\D/g, '');
  if (cleanAadhaar.length !== 12 && cleanMobile.length !== 10) {
    return NextResponse.json({ error: 'Provide valid Aadhaar (12 digits) OR Mobile (10 digits)' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  let query = serviceClient
    .from('customers')
    .select(`
      id, customer_name, father_name, aadhaar, mobile,
      alternate_number_1, alternate_number_2,
      model_no, imei, purchase_value, down_payment, disburse_amount,
      purchase_date, emi_due_day, emi_amount, emi_tenure,
      first_emi_charge_amount, first_emi_charge_paid_at,
      customer_photo_url, status,
      retailer:retailers(name, mobile)
    `)
    .eq('status', 'RUNNING');

  if (cleanAadhaar.length === 12) query = query.eq('aadhaar', cleanAadhaar);
  else query = query.eq('mobile', cleanMobile);

  const { data: customer, error } = await query.single();

  if (error || !customer) {
    return NextResponse.json(
      { error: 'No matching running customer found.' },
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
