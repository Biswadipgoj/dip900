import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cleanAadhaar = String(body?.aadhaar || '').replace(/\D/g, '');
  const cleanMobile = String(body?.mobile || '').replace(/\D/g, '');

  if (cleanAadhaar.length !== 12 && cleanMobile.length !== 10) {
    return NextResponse.json({ error: 'Provide valid Aadhaar (12 digits) OR Mobile (10 digits)' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  let rows: Array<Record<string, unknown>> = [];
  if (cleanAadhaar.length === 12) {
    const { data, error } = await serviceClient
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
      .eq('status', 'RUNNING')
      .eq('aadhaar', cleanAadhaar)
      .limit(2);

    if (error) return NextResponse.json({ error: 'Login failed' }, { status: 500 });
    rows = data || [];
  } else {
    const { data, error } = await serviceClient
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
      .eq('status', 'RUNNING')
      .eq('mobile', cleanMobile)
      .limit(2);

    if (error) return NextResponse.json({ error: 'Login failed' }, { status: 500 });
    rows = data || [];
    if (rows.length > 1) {
      return NextResponse.json({ error: 'Multiple customers found, use Aadhaar' }, { status: 409 });
    }
  }

  const customer = rows[0];
  if (!customer) {
    return NextResponse.json({ error: 'No matching running customer found.' }, { status: 401 });
  }

  const customerId = String(customer.id);

  const { data: emis } = await serviceClient
    .from('emi_schedule')
    .select('id, emi_no, due_date, amount, status, paid_at, mode, fine_amount, fine_waived')
    .eq('customer_id', customerId)
    .order('emi_no');

  const { data: breakdown } = await serviceClient.rpc('get_due_breakdown', {
    p_customer_id: customerId,
  });

  return NextResponse.json({ customer, emis: emis || [], breakdown });
}
