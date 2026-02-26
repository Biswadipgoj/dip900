import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { format } from 'date-fns';

function fmt(n: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n || 0); }

export async function GET(_: Request, { params }: { params: { customer_id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data: customer } = await service.from('customers').select('*, retailer:retailers(name,mobile)').eq('id', params.customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (customer.status !== 'COMPLETE') return NextResponse.json({ error: 'Bill allowed only for completed customers' }, { status: 400 });

  const { data: emis } = await service.from('emi_schedule').select('*').eq('customer_id', params.customer_id).order('emi_no');
  const paid = (emis || []).filter((e) => e.status === 'APPROVED');
  const total = paid.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Final Bill</title></head><body style="font-family:Arial;padding:20px;color:#0f172a">
  <h2>TelePoint Final Bill ${customer.is_settled ? '(SETTLED)' : ''}</h2>
  <p>Customer: <b>${customer.customer_name}</b> | Mobile: ${customer.mobile} | IMEI: ${customer.imei}</p>
  <p>Retailer: ${(customer.retailer as { name?: string })?.name ?? '-'} | Retailer Mobile: ${(customer.retailer as { mobile?: string })?.mobile ?? '-'}</p>
  <p>First EMI Charge: ${fmt(customer.first_emi_charge_amount)} (${customer.first_emi_charge_paid_at ? 'Paid' : 'Pending'})</p>
  <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr><th>EMI</th><th>Due Date</th><th>Paid At</th><th>Amount</th></tr>
  ${paid.map((e) => `<tr><td>${e.emi_no}</td><td>${format(new Date(e.due_date), 'd MMM yyyy')}</td><td>${e.paid_at ? format(new Date(e.paid_at), 'd MMM yyyy') : '-'}</td><td>${fmt(e.amount)}</td></tr>`).join('')}
  </table><h3>Total Paid: ${fmt(total)}</h3><p>Generated: ${format(new Date(), 'd MMM yyyy, h:mm a')}</p></body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="bill-${customer.imei}.html"` } });
}
