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
  const { request_id, reason } = body;
  if (!request_id || !reason) {
    return NextResponse.json({ error: 'request_id and reason are required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: request, error: fetchErr } = await serviceClient
    .from('payment_requests')
    .select('*, payment_request_items(*)')
    .eq('id', request_id)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  if (request.status !== 'PENDING') {
    return NextResponse.json({ error: 'Request is not pending' }, { status: 400 });
  }

  // ── Extract EMI IDs using correct column name ────────────────────────────
  const items: Array<{ emi_schedule_id: string }> = request.payment_request_items || [];
  const emiIds = items.map(i => i.emi_schedule_id).filter(Boolean);

  // Revert EMIs to UNPAID
  if (emiIds.length > 0) {
    const { error: emiErr } = await serviceClient
      .from('emi_schedule')
      .update({ status: 'UNPAID' })
      .in('id', emiIds);

    if (emiErr) {
      console.error('Failed to revert EMIs on reject:', emiErr);
      return NextResponse.json({ error: 'Failed to revert EMI status: ' + emiErr.message }, { status: 500 });
    }
  }

  // Update request
  await serviceClient.from('payment_requests').update({
    status: 'REJECTED',
    rejected_by: user.id,
    rejected_at: new Date().toISOString(),
    rejection_reason: reason,
  }).eq('id', request_id);

  // Audit log
  await serviceClient.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'REJECT_PAYMENT',
    table_name: 'payment_requests',
    record_id: request_id,
    before_data: { status: 'PENDING' },
    after_data: { status: 'REJECTED', reason },
    remark: reason,
  });

  return NextResponse.json({ success: true });
}
