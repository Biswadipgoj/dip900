import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Only admins can record direct payments' }, { status: 403 });

  const body = await req.json();
  const { customer_id, emi_ids, mode, utr, notes, total_emi_amount, scheduled_emi_amount, fine_amount, first_emi_charge_amount, total_amount, fine_for_emi_no, fine_due_date, collect_type } = body;

  const isFineOnly = collect_type === 'fine_only';

  if (!customer_id || (!isFineOnly && !emi_ids?.length) || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (mode === 'UPI' && !utr?.trim()) {
    return NextResponse.json({ error: 'UTR is required for UPI payments' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: customer } = await serviceClient.from('customers').select('*, retailers(*)').eq('id', customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const now = new Date().toISOString();

  // Get EMIs (may be empty for fine-only)
  const emis = (!isFineOnly && emi_ids?.length > 0)
    ? (await serviceClient.from('emi_schedule').select('*').in('id', emi_ids).eq('customer_id', customer_id)).data || []
    : [];

  // Create request as already APPROVED
  const { data: request, error } = await serviceClient.from('payment_requests').insert({
    customer_id,
    retailer_id: customer.retailer_id,
    submitted_by: user.id,
    status: 'APPROVED',
    mode,
    utr: utr || null,
    total_emi_amount: total_emi_amount || 0,
    scheduled_emi_amount: scheduled_emi_amount || 0,
    fine_amount: fine_amount || 0,
    first_emi_charge_amount: first_emi_charge_amount || 0,
    total_amount,
    notes: [notes, utr ? `UTR: ${utr}` : ''].filter(Boolean).join(' | ') || null,
    approved_by: user.id,
    approved_at: now,
    fine_for_emi_no: fine_for_emi_no || null,
    fine_due_date: fine_due_date || null,
    collected_by_role: 'admin',
    collected_by_user_id: user.id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create items (if EMI collected)
  if (emis.length > 0) {
    const items = emis.map((emi: { id: string; emi_no: number; amount: number }) => ({
      payment_request_id: request.id,
      emi_schedule_id: emi.id,
      emi_no: emi.emi_no,
      amount: emi.amount,
    }));
    await serviceClient.from('payment_request_items').insert(items);

    // Approve EMIs directly
    await serviceClient.from('emi_schedule').update({
      status: 'APPROVED',
      paid_at: now,
      mode,
      utr: utr || null,
      approved_by: user.id,
      collected_by_role: 'admin',
      collected_by_user_id: user.id,
    }).in('id', emi_ids);
  }

  // Handle fine payment — record fine_paid_amount on overdue EMIs
  if (fine_amount > 0) {
    if (emis.length > 0) {
      const lowestEmiNo = Math.min(...emis.map((e: { emi_no: number }) => e.emi_no));
      await serviceClient.from('emi_schedule')
        .update({ fine_paid_amount: fine_amount, fine_paid_at: now })
        .eq('customer_id', customer_id)
        .eq('emi_no', lowestEmiNo);
    } else {
      // Fine-only: apply to first overdue EMI
      const { data: overdueEmi } = await serviceClient
        .from('emi_schedule')
        .select('id')
        .eq('customer_id', customer_id)
        .eq('status', 'UNPAID')
        .lt('due_date', new Date().toISOString().split('T')[0])
        .order('emi_no')
        .limit(1)
        .single();
      if (overdueEmi) {
        await serviceClient.from('emi_schedule').update({
          fine_paid_amount: fine_amount,
          fine_paid_at: now,
        }).eq('id', overdueEmi.id);
      }
    }
  }

  // Mark first EMI charge paid if applicable
  if (first_emi_charge_amount > 0) {
    await serviceClient.from('customers').update({ first_emi_charge_paid_at: now }).eq('id', customer_id);
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
