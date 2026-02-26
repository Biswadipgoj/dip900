import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n || 0);
}

export async function GET(_: Request, { params }: { params: { payment_id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from('profiles').select('role').eq('user_id', user.id).single();

  const { data: payment } = await service
    .from('payment_requests')
    .select('*, customer:customers(customer_name,mobile,imei,model_no), retailer:retailers(name,auth_user_id), items:payment_request_items(emi_no,amount)')
    .eq('id', params.payment_id)
    .single();

  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const role = profile?.role;
  if (role !== 'super_admin' && !(role === 'retailer' && payment.retailer?.auth_user_id === user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const c = payment.customer || {};
  const items = payment.items || [];
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Receipt</title>
<style>body{font-family:Arial,sans-serif;padding:20px;color:#0f172a} .card{max-width:680px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden} .h{background:#eab308;padding:16px;font-weight:700} .b{padding:16px} table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left} .r{text-align:right}</style>
</head><body><div class="card"><div class="h">TelePoint EMI Receipt #${payment.id.slice(0,8).toUpperCase()}</div><div class="b">
<p><b>${c.customer_name || ''}</b> · ${c.mobile || ''} · ${c.imei || ''}</p>
<table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>
${items.map((i: {emi_no:number; amount:number}) => `<tr><td>EMI #${i.emi_no}</td><td class="r">${fmt(i.amount)}</td></tr>`).join('')}
${(payment.first_emi_charge_amount||0)>0?`<tr><td>1st EMI Charge</td><td class="r">${fmt(payment.first_emi_charge_amount)}</td></tr>`:''}
${(payment.fine_amount||0)>0?`<tr><td>Fine</td><td class="r">${fmt(payment.fine_amount)}</td></tr>`:''}
<tr><th>Total</th><th class="r">${fmt(payment.total_amount)}</th></tr>
</tbody></table>
<p>Mode: ${payment.mode} | Status: ${payment.status}</p>
</div></div></body></html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="receipt-${payment.id.slice(0, 8)}.html"`,
      'Cache-Control': 'no-store',
    },
  });
}
