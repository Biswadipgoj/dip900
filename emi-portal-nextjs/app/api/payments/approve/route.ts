import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { request_id, remark } = body;
  if (!request_id) return NextResponse.json({ error: 'request_id required' }, { status: 400 });

  console.log('APPROVING REQUEST', request_id);

  const serviceClient = createServiceClient();

  // Fetch request + items (items use emi_schedule_id per schema)
  const { data: request, error: fetchErr } = await serviceClient
    .from('payment_requests')
    .select('*, payment_request_items(*)')
    .eq('id', request_id)
    .single();

  if (fetchErr || !request) {
    console.error('Fetch request error:', fetchErr);
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  if (request.status !== 'PENDING') {
    return NextResponse.json({ error: 'Request is not pending' }, { status: 400 });
  }

  // ── Extract EMI schedule IDs from items ──────────────────────────────────
  // Schema: payment_request_items.emi_schedule_id (fixed — was wrongly read before)
  const items: Array<{ emi_schedule_id: string; emi_no: number; amount: number }> =
    request.payment_request_items || [];

  const emiIds = items.map(i => i.emi_schedule_id).filter(Boolean);

  if (emiIds.length === 0) {
    console.error('No EMI IDs found in payment_request_items for request', request_id, items);
    return NextResponse.json({ error: 'No EMI items found on this request — cannot approve' }, { status: 400 });
  }

  console.log('EMI IDs to approve:', emiIds);

  const now = new Date().toISOString();

  // ── STEP 1: Mark all linked EMIs as APPROVED ──────────────────────────────
  const { error: emiErr } = await serviceClient
    .from('emi_schedule')
    .update({
      status: 'APPROVED',
      paid_at: now,
      mode: request.mode,
      approved_by: user.id,
      collected_by_role: 'retailer',
      collected_by_user_id: request.submitted_by,
    })
    .in('id', emiIds);

  if (emiErr) {
    console.error('Failed to update emi_schedule:', emiErr);
    return NextResponse.json({ error: 'Failed to mark EMIs as paid: ' + emiErr.message }, { status: 500 });
  }

  console.log('EMI schedule updated to APPROVED for IDs:', emiIds);

  // ── STEP 2: Mark first EMI charge paid if included ────────────────────────
  if ((request.first_emi_charge_amount ?? 0) > 0) {
    const { error: chargeErr } = await serviceClient
      .from('customers')
      .update({ first_emi_charge_paid_at: now })
      .eq('id', request.customer_id)
      .is('first_emi_charge_paid_at', null);   // idempotent — only if not already set

    if (chargeErr) {
      console.error('Failed to mark first_emi_charge paid:', chargeErr);
      // Non-fatal — continue
    }
  }

  // ── STEP 3: If fine was collected, zero out fine on those EMIs ────────────
  if ((request.fine_amount ?? 0) > 0) {
    // Fine always applies to the lowest-numbered EMI in the request
    const lowestEmiNo = Math.min(...items.map(i => i.emi_no));
    const { error: fineErr } = await serviceClient
      .from('emi_schedule')
      .update({ fine_amount: 0, fine_waived: true })
      .eq('customer_id', request.customer_id)
      .eq('emi_no', lowestEmiNo);

    if (fineErr) {
      console.error('Failed to clear fine:', fineErr);
      // Non-fatal — continue
    }
  }

  // ── STEP 4: Update payment_request status ────────────────────────────────
  const { error: reqErr } = await serviceClient
    .from('payment_requests')
    .update({
      status: 'APPROVED',
      approved_by: user.id,
      approved_at: now,
      notes: remark
        ? (request.notes ? request.notes + '\nAdmin remark: ' + remark : 'Admin remark: ' + remark)
        : request.notes,
    })
    .eq('id', request_id);

  if (reqErr) {
    console.error('Failed to update payment_requests:', reqErr);
    return NextResponse.json({ error: 'Failed to update request: ' + reqErr.message }, { status: 500 });
  }

  // ── STEP 5: Audit log ────────────────────────────────────────────────────
  await serviceClient.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'APPROVE_PAYMENT',
    table_name: 'payment_requests',
    record_id: request_id,
    before_data: { status: 'PENDING' },
    after_data: { status: 'APPROVED', emi_ids: emiIds, approved_at: now },
    remark,
  });

  // ── STEP 6: Auto-complete customer if all EMIs now approved ──────────────
  const { data: remainingUnpaid } = await serviceClient
    .from('emi_schedule')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', request.customer_id)
    .in('status', ['UNPAID', 'PENDING_APPROVAL']);

  if ((remainingUnpaid as unknown as { count: number } | null)?.count === 0) {
    await serviceClient
      .from('customers')
      .update({ status: 'COMPLETE', completion_date: now.split('T')[0] })
      .eq('id', request.customer_id)
      .eq('status', 'RUNNING');   // idempotent — don't overwrite existing completion_remark
  }

  console.log('PAYMENT APPROVED SUCCESSFULLY', { request_id, emi_ids: emiIds });
  return NextResponse.json({ success: true, request_id, emi_ids: emiIds });
}
