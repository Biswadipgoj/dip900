import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const service = createServiceClient();
  const { data: profile } = await service.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { customer_id, settlement_amount_collected, settlement_date, note } = body;
  if (!customer_id || !settlement_amount_collected || !settlement_date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { data: customer } = await service.from('customers').select('status').eq('id', customer_id).single();
  if (!customer || customer.status !== 'RUNNING') return NextResponse.json({ error: 'Only RUNNING customers can be settled' }, { status: 400 });

  const now = new Date().toISOString();
  const { error: settleErr } = await service.from('customer_settlements').insert({
    customer_id,
    settlement_amount_collected,
    settlement_date,
    note: note || null,
    settled_by_user_id: user.id,
    settled_at: now,
  });
  if (settleErr) return NextResponse.json({ error: settleErr.message }, { status: 500 });

  const { error: custErr } = await service.from('customers').update({
    status: 'COMPLETE',
    is_settled: true,
    settled_at: now,
    completion_date: settlement_date,
  }).eq('id', customer_id);
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

  await service.from('audit_log').insert({
    actor_user_id: user.id,
    actor_role: 'super_admin',
    action: 'SETTLE_CUSTOMER',
    table_name: 'customers',
    record_id: customer_id,
    after_data: { settlement_amount_collected, settlement_date, note: note || null, is_settled: true },
  });

  return NextResponse.json({ success: true });
}
