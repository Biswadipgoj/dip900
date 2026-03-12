import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Auth: super_admin only
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 });
  }

  const svc = createServiceClient();
  const paymentId = params.id;

  // Fetch current record for audit log
  const { data: before, error: fetchErr } = await svc
    .from('payment_requests')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (fetchErr || !before) {
    return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
  }

  const body = await req.json();
  const {
    status,
    mode,
    total_emi_amount,
    fine_amount,
    first_emi_charge_amount,
    total_amount,
    notes,
    paid_at,
    approved_by,
    collected_by_role,
    collected_by_user_id,
  } = body as Record<string, unknown>;

  // Build update payload — only include fields that were sent
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (status !== undefined) updates.status = status;
  if (mode !== undefined) updates.mode = mode;
  if (total_emi_amount !== undefined) updates.total_emi_amount = Number(total_emi_amount);
  if (fine_amount !== undefined) updates.fine_amount = Number(fine_amount);
  if (first_emi_charge_amount !== undefined) updates.first_emi_charge_amount = Number(first_emi_charge_amount);
  if (total_amount !== undefined) updates.total_amount = Number(total_amount);
  if (notes !== undefined) updates.notes = notes;
  if (approved_by !== undefined) updates.approved_by = approved_by;
  if (collected_by_role !== undefined) updates.collected_by_role = collected_by_role;
  if (collected_by_user_id !== undefined) updates.collected_by_user_id = collected_by_user_id;

  // If status changed to APPROVED, set approved_at
  if (status === 'APPROVED' && before.status !== 'APPROVED') {
    updates.approved_at = paid_at || new Date().toISOString();
    updates.approved_by = updates.approved_by || user.id;
  }

  // Update the payment request
  const { error: updateErr } = await svc
    .from('payment_requests')
    .update(updates)
    .eq('id', paymentId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // If status changed, update linked EMI schedule rows
  const { data: items } = await svc
    .from('payment_request_items')
    .select('emi_schedule_id, emi_no')
    .eq('payment_request_id', paymentId);

  const emiIds = (items || []).map(i => i.emi_schedule_id).filter(Boolean);

  if (emiIds.length > 0) {
    if (status === 'APPROVED' && before.status !== 'APPROVED') {
      // Mark EMIs as APPROVED
      await svc.from('emi_schedule').update({
        status: 'APPROVED',
        paid_at: paid_at || new Date().toISOString(),
        mode: (mode as string) || before.mode,
        approved_by: user.id,
        collected_by_role: (collected_by_role as string) || before.collected_by_role || 'admin',
        collected_by_user_id: (collected_by_user_id as string) || before.collected_by_user_id || user.id,
      }).in('id', emiIds);

      // Clear fine if fine was collected
      if ((Number(fine_amount ?? before.fine_amount) || 0) > 0) {
        const lowestEmiNo = Math.min(...(items || []).map(i => i.emi_no));
        await svc.from('emi_schedule')
          .update({ fine_amount: 0 })
          .eq('customer_id', before.customer_id)
          .eq('emi_no', lowestEmiNo);
      }
    } else if (status === 'REJECTED' && before.status !== 'REJECTED') {
      // Revert EMIs to UNPAID
      await svc.from('emi_schedule').update({
        status: 'UNPAID',
        paid_at: null,
        mode: null,
        approved_by: null,
      }).in('id', emiIds);
    } else if (status === 'PENDING' && before.status !== 'PENDING') {
      await svc.from('emi_schedule').update({
        status: 'PENDING_APPROVAL',
      }).in('id', emiIds);
    }
  }

  // Audit log
  await svc.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'EDIT_PAYMENT',
    table_name: 'payment_requests',
    record_id: paymentId,
    before_data: before,
    after_data: updates,
    remark: `Admin edited payment: ${Object.keys(updates).filter(k => k !== 'updated_at').join(', ')}`,
  });

  return NextResponse.json({ success: true, updated: updates });
}
