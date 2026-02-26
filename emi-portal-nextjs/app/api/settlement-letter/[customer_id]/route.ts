import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function fmt(n: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n || 0); }

export async function GET(_: Request, { params }: { params: { customer_id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: customer } = await service.from('customers').select('*, retailer:retailers(name,mobile)').eq('id', params.customer_id).single();
  const { data: settlement } = await service.from('customer_settlements').select('*').eq('customer_id', params.customer_id).order('settled_at', { ascending: false }).limit(1).maybeSingle();
  if (!customer || !settlement) return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#111827"><h2>Settlement Letter</h2>
<p>This account is settled/closed.</p>
<p><b>Customer:</b> ${customer.customer_name} (${customer.mobile})</p>
<p><b>Retailer:</b> ${customer.retailer?.name || '-'} (${customer.retailer?.mobile || '-'})</p>
<p><b>Settlement Amount:</b> ${fmt(settlement.settlement_amount_collected)}</p>
<p><b>Settlement Date:</b> ${settlement.settlement_date}</p>
<p><b>Prepared by:</b> Super Admin (${user.id}) at ${new Date().toISOString()}</p>
<p><b>Note:</b> ${settlement.note || '-'}</p>
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="settlement-${params.customer_id.slice(0,8)}.html"` } });
}
