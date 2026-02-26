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
  if (!customer || customer.status !== 'COMPLETE') return NextResponse.json({ error: 'Completed customer required' }, { status: 400 });
  const { data: emis } = await service.from('emi_schedule').select('*').eq('customer_id', params.customer_id).eq('status', 'APPROVED').order('emi_no');

  const html = `<!doctype html><html><body style="font-family:Arial;padding:20px"><h2>EMI Final Bill</h2><p>${customer.customer_name} (${customer.mobile})</p><p>Status: COMPLETE ${customer.is_settled ? '· SETTLED' : ''}</p><table border="1" cellpadding="6" cellspacing="0"><tr><th>EMI</th><th>Amount</th></tr>${(emis||[]).map((e:any)=>`<tr><td>#${e.emi_no}</td><td>${fmt(e.amount)}</td></tr>`).join('')}</table></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="bill-${params.customer_id.slice(0,8)}.html"` } });
}
