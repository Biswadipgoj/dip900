import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    customer_id,
    emi_ids,
    emi_nos,
    mode,
    utr,
    notes,
    retail_pin,
    total_emi_amount,
    scheduled_emi_amount,
    fine_amount,
    first_emi_charge_amount,
    total_amount,
    fine_for_emi_no,
    fine_due_date,
    collected_by_role,
    collect_type,
  } = body;

  const isFineOnly = collect_type === 'fine_only';

  if (!customer_id || (!isFineOnly && !emi_ids?.length) || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!retail_pin?.trim()) {
    return NextResponse.json({ error: 'Retailer PIN is required' }, { status: 400 });
  }
  if (mode === 'UPI' && !utr?.trim()) {
    return NextResponse.json({ error: 'UTR is required for UPI payments' }, { status: 400 });
  }

  const supabase = createClient();
  const serviceClient = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Verify retail PIN
  const { data: retailer } = await serviceClient
    .from('retailers')
    .select('id, retail_pin, is_active')
    .eq('auth_user_id', user.id)
    .single();

  if (!retailer || !retailer.is_active) {
    return NextResponse.json({ error: 'Retailer account is inactive' }, { status: 403 });
  }
  if (retailer.retail_pin !== retail_pin) {
    return NextResponse.json({ error: 'Incorrect Retailer PIN' }, { status: 401 });
  }

  // Guard: ensure EMIs are still UNPAID (not already pending/approved) — skip for fine-only
  if (!isFineOnly && emi_ids?.length > 0) {
    const { data: emiCheck } = await serviceClient
      .from('emi_schedule')
      .select('id, status')
      .in('id', emi_ids)
      .eq('customer_id', customer_id);

    const notUnpaid = (emiCheck || []).filter(e => e.status !== 'UNPAID');
    if (notUnpaid.length > 0) {
      return NextResponse.json({ error: 'One or more EMIs are already pending or paid' }, { status: 409 });
    }
  }

  // Create payment request
  const { data: request, error: reqErr } = await serviceClient
    .from('payment_requests')
    .insert({
      customer_id,
      retailer_id: retailer.id,
      submitted_by: user.id,
      status: 'PENDING',
      mode,
      utr: utr || null,
      total_emi_amount: total_emi_amount || 0,
      scheduled_emi_amount: scheduled_emi_amount || 0,
      fine_amount: fine_amount || 0,
      first_emi_charge_amount: first_emi_charge_amount || 0,
      total_amount: total_amount || 0,
      notes: [notes, utr ? `UTR: ${utr}` : ''].filter(Boolean).join(' | ') || null,
      selected_emi_nos: emi_nos || [],
      fine_for_emi_no: fine_for_emi_no || null,
      fine_due_date: fine_due_date || null,
      collected_by_role: collected_by_role || 'retailer',
      collected_by_user_id: user.id,
    })
    .select()
    .single();

  if (reqErr || !request) {
    return NextResponse.json({ error: reqErr?.message || 'Failed to create request' }, { status: 500 });
  }

  // Insert payment_request_items — skip for fine-only
  if (!isFineOnly && emi_ids?.length > 0) {
    const items = emi_ids.map((emi_schedule_id: string, i: number) => ({
      payment_request_id: request.id,
      emi_schedule_id,
      emi_no: emi_nos[i],
      amount: parseFloat(total_emi_amount) / emi_ids.length,
    }));
    const { error: itemsErr } = await serviceClient.from('payment_request_items').insert(items);
    if (itemsErr) {
      console.error('Failed to insert payment_request_items:', itemsErr);
      await serviceClient.from('payment_requests').delete().eq('id', request.id);
      return NextResponse.json({ error: 'Failed to record EMI items' }, { status: 500 });
    }

    // Mark EMIs as PENDING_APPROVAL
    await serviceClient
      .from('emi_schedule')
      .update({ status: 'PENDING_APPROVAL' })
      .in('id', emi_ids);
  }

  // For fine-only: record fine_paid_amount on the first overdue EMI
  if (isFineOnly && fine_amount > 0) {
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
        fine_paid_at: new Date().toISOString(),
      }).eq('id', overdueEmi.id);
    }
  }

  return NextResponse.json({ success: true, request_id: request.id });
}
