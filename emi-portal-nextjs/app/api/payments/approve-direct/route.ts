import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Only admins can record direct payments' }, { status: 403 });

  const body = await req.json();
  const { customer_id, emi_ids, emi_amounts, mode, notes, total_emi_amount, fine_amount, first_emi_charge_amount, total_amount } = body;

  if (!customer_id || !emi_ids?.length || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: customer } = await serviceClient.from('customers').select('*, retailers(*)').eq('id', customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const now = new Date().toISOString();

  // Get retailer
  const { data: emis } = await serviceClient.from('emi_schedule').select('*').in('id', emi_ids).eq('customer_id', customer_id);

  // Create request as already APPROVED
  const { data: request, error } = await serviceClient.from('payment_requests').insert({
    customer_id,
    retailer_id: customer.retailer_id,
    submitted_by: user.id,
    status: 'APPROVED',
    mode,
    total_emi_amount: total_emi_amount || 0,
    fine_amount: fine_amount || 0,
    first_emi_charge_amount: first_emi_charge_amount || 0,
    total_amount,
    notes,
    approved_by: user.id,
    approved_at: now,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create items
  const items = (emis || []).map(emi => ({
    payment_request_id: request.id,
    emi_schedule_id: emi.id,
    emi_no: emi.emi_no,
    amount: Number(emi_amounts?.[(emis || []).findIndex((x:any)=>x.id===emi.id)] ?? emi.amount),
  }));
  await serviceClient.from('payment_request_items').insert(items);

  // Approve EMIs directly
  for (const emi of (emis || [])) {
    const paidNow = Number(emi_amounts?.[(emis || []).findIndex((x:any)=>x.id===emi.id)] ?? emi.amount);
    const nextPaid = Number(emi.paid_amount || 0) + paidNow;
    await serviceClient.from('emi_schedule').update({
      paid_amount: nextPaid,
      status: nextPaid >= Number(emi.amount) ? 'APPROVED' : 'UNPAID',
      paid_at: nextPaid >= Number(emi.amount) ? now : null,
      mode,
      approved_by: user.id,
      collected_by_role: 'admin',
      collected_by_user_id: user.id,
    }).eq('id', emi.id);
  }

  // Mark first EMI charge paid if applicable
  if (first_emi_charge_amount > 0) {
    const { data: c } = await serviceClient.from('customers').select('first_emi_charge_paid_amount, first_emi_charge_amount').eq('id', customer_id).single();
    const next = Number(c?.first_emi_charge_paid_amount || 0) + Number(first_emi_charge_amount);
    await serviceClient.from('customers').update({
      first_emi_charge_paid_amount: next,
      first_emi_charge_paid_at: next >= Number(c?.first_emi_charge_amount || 0) ? now : null,
    }).eq('id', customer_id);
  }

  // Audit log
  await serviceClient.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'DIRECT_PAYMENT',
    table_name: 'payment_requests',
    record_id: request.id,
    after_data: { customer_id, total_amount, mode },
  });

  return NextResponse.json({ request_id: request.id });
}
