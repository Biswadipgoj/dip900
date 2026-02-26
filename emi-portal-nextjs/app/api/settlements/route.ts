import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { customer_id, settlement_amount_collected, settlement_date, note } = body;
  if (!customer_id || !settlement_amount_collected || !settlement_date) {
    return NextResponse.json({ error: 'customer_id, settlement_amount_collected, settlement_date are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: customer } = await service.from('customers').select('id,status').eq('id', customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  if (customer.status !== 'RUNNING') return NextResponse.json({ error: 'Settlement allowed only for RUNNING customers' }, { status: 400 });

  const { data: settlement, error } = await service.from('customer_settlements').insert({
    customer_id,
    settlement_amount_collected,
    settlement_date,
    note: note || null,
    settled_by_user_id: user.id,
  }).select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: updateErr } = await service.from('customers').update({
    status: 'COMPLETE',
    is_settled: true,
    completion_date: settlement_date,
    completion_remark: note || 'Settled by super admin',
  }).eq('id', customer_id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ settlement });
}
