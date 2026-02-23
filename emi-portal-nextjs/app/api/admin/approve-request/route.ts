/**
 * POST /api/admin/approve-request
 *
 * Atomically approves a retailer payment request using the DB stored procedure
 * approve_payment_request(). Falls back to sequential steps if RPC unavailable.
 *
 * All DB writes use SERVICE ROLE — never exposed to frontend.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  const body = await req.json();
  const { request_id, remark } = body as { request_id?: string; remark?: string };
  if (!request_id) {
    return NextResponse.json({ error: 'request_id is required' }, { status: 400 });
  }

  console.log('APPROVING REQUEST', request_id, { admin: user.id });

  const svc = createServiceClient();

  // ── PRIMARY PATH: Call atomic DB stored procedure ─────────────────────────
  // This runs everything in a single transaction with FOR UPDATE row locking.
  const { data: rpcResult, error: rpcErr } = await svc.rpc('approve_payment_request', {
    p_request_id: request_id,
    p_admin_id:   user.id,
    p_remark:     remark ?? null,
  });

  if (!rpcErr && rpcResult) {
    const result = rpcResult as { success: boolean; error?: string; already_approved?: boolean; emi_ids?: string[] };

    if (result.success) {
      console.log('PAYMENT APPROVED SUCCESSFULLY via RPC', result);
      return NextResponse.json({ success: true, ...result });
    }

    // DB function returned a business-logic error
    console.error('RPC approve_payment_request returned error:', result.error);
    return NextResponse.json({ error: result.error || 'Approval failed' }, { status: 422 });
  }

  // RPC not available yet (migration 003 not run) → fall back to sequential steps
  console.warn('RPC unavailable, falling back to sequential approval:', rpcErr?.message);

  // ── FALLBACK PATH ─────────────────────────────────────────────────────────

  // Fetch request + items
  const { data: request, error: fetchErr } = await svc
    .from('payment_requests')
    .select(`
      id, customer_id, retailer_id, submitted_by, status, mode,
      total_emi_amount, fine_amount, first_emi_charge_amount, total_amount,
      notes, selected_emi_nos,
      payment_request_items ( id, emi_schedule_id, emi_no, amount )
    `)
    .eq('id', request_id)
    .single();

  if (fetchErr || !request) {
    console.error('Fetch request error:', fetchErr);
    return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  }

  // Idempotency
  if (request.status === 'APPROVED') {
    return NextResponse.json({ success: true, already_approved: true, request_id });
  }
  if (request.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Cannot approve: status is ${request.status}` },
      { status: 400 }
    );
  }

  type Item = { id: string; emi_schedule_id: string; emi_no: number; amount: number };
  const items: Item[] = (request.payment_request_items as Item[]) || [];
  let emiIds = items.map(i => i.emi_schedule_id).filter(Boolean);

  // Fallback: resolve from selected_emi_nos if items are missing
  if (emiIds.length === 0 && request.selected_emi_nos?.length) {
    console.warn('No items — resolving from selected_emi_nos', request.selected_emi_nos);
    const { data: fallbackEmis } = await svc
      .from('emi_schedule')
      .select('id, emi_no')
      .eq('customer_id', request.customer_id)
      .in('emi_no', request.selected_emi_nos);

    if (fallbackEmis?.length) {
      emiIds = fallbackEmis.map(e => e.id);
      // Backfill items so future reads work
      await svc.from('payment_request_items').insert(
        fallbackEmis.map(e => ({
          payment_request_id: request_id,
          emi_schedule_id: e.id,
          emi_no: e.emi_no,
          amount: (request.total_emi_amount as number) / fallbackEmis.length,
        }))
      );
    }
  }

  if (emiIds.length === 0) {
    console.error('Cannot resolve EMI IDs for request', request_id);
    return NextResponse.json(
      { error: 'No EMI items linked to this request — cannot approve' },
      { status: 422 }
    );
  }

  const now = new Date().toISOString();
  const allEmiNos = items.length > 0
    ? items.map(i => i.emi_no)
    : (request.selected_emi_nos ?? []);
  const lowestEmiNo = allEmiNos.length > 0 ? Math.min(...allEmiNos) : null;

  // STEP A: Mark EMIs APPROVED
  const { error: emiErr } = await svc
    .from('emi_schedule')
    .update({
      status:               'APPROVED',
      paid_at:              now,
      mode:                 request.mode,
      approved_by:          user.id,
      collected_by_role:    'retailer',
      collected_by_user_id: request.submitted_by,
    })
    .in('id', emiIds);

  if (emiErr) {
    console.error('STEP A — emi_schedule update failed:', emiErr);
    return NextResponse.json({ error: 'Failed to mark EMIs as paid: ' + emiErr.message }, { status: 500 });
  }
  console.log('STEP A OK — EMIs marked APPROVED:', emiIds);

  // STEP B: Clear fine
  if ((request.fine_amount as number) > 0 && lowestEmiNo !== null) {
    await svc
      .from('emi_schedule')
      .update({ fine_amount: 0, fine_waived: true })
      .eq('customer_id', request.customer_id)
      .eq('emi_no', lowestEmiNo)
      .eq('status', 'APPROVED');
  }

  // STEP C: First EMI charge
  if ((request.first_emi_charge_amount as number) > 0) {
    await svc
      .from('customers')
      .update({ first_emi_charge_paid_at: now })
      .eq('id', request.customer_id)
      .is('first_emi_charge_paid_at', null);
  }

  // STEP D: Update request
  const { error: reqErr } = await svc
    .from('payment_requests')
    .update({
      status:      'APPROVED',
      approved_by: user.id,
      approved_at: now,
      notes: remark
        ? ((request.notes ? (request.notes as string) + '\n' : '') + 'Admin remark: ' + remark)
        : (request.notes as string ?? null),
    })
    .eq('id', request_id);

  if (reqErr) {
    console.error('STEP D — payment_requests update failed:', reqErr);
    // EMIs already approved — don't roll back, log and return partial success
    return NextResponse.json({
      error: 'EMIs marked paid but request status update failed: ' + reqErr.message,
      partial: true,
      emi_ids: emiIds,
    }, { status: 500 });
  }

  // STEP E: Auto-complete customer
  const { count: unpaidCount } = await svc
    .from('emi_schedule')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', request.customer_id)
    .in('status', ['UNPAID', 'PENDING_APPROVAL']);

  if (unpaidCount === 0) {
    await svc
      .from('customers')
      .update({ status: 'COMPLETE', completion_date: now.split('T')[0] })
      .eq('id', request.customer_id)
      .eq('status', 'RUNNING');
  }

  // STEP F: Audit
  await svc.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role:    'super_admin',
    action:        'APPROVE_PAYMENT',
    table_name:    'payment_requests',
    record_id:     request_id,
    before_data:   { status: 'PENDING' },
    after_data:    { status: 'APPROVED', emi_ids: emiIds, approved_at: now },
    remark:        remark ?? null,
  });

  console.log('PAYMENT APPROVED SUCCESSFULLY (fallback)', { request_id, emi_ids: emiIds });
  return NextResponse.json({ success: true, request_id, emi_ids: emiIds, approved_at: now });
}
