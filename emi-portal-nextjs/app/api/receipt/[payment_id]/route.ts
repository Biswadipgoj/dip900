import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { format } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(n || 0);
}

export async function GET(_: Request, { params }: { params: { payment_id: string } }) {
  const supabase = createServiceClient();

  const { data: request } = await supabase
    .from('payment_requests')
    .select(`
      id,
      customer_id,
      status,
      mode,
      total_emi_amount,
      fine_amount,
      total_amount,
      created_at,
      customer:customers(customer_name, customer_photo_url),
      retailer:retailers(name)
    `)
    .eq('id', params.payment_id)
    .single();

  if (!request) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  const { data: nextEmi } = await supabase
    .from('emi_schedule')
    .select('due_date')
    .eq('customer_id', request.customer_id)
    .eq('status', 'UNPAID')
    .order('emi_no', { ascending: true })
    .limit(1)
    .maybeSingle();

  const customer = request.customer as { customer_name?: string; customer_photo_url?: string } | null;
  const retailer = request.retailer as { name?: string } | null;
  const photoHtml = customer?.customer_photo_url
    ? `<img src="${customer.customer_photo_url}" alt="Customer photo" style="width:110px;height:110px;object-fit:cover;border-radius:10px;border:1px solid #cbd5e1;" />`
    : `<div style="width:110px;height:110px;border-radius:10px;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px;">No photo</div>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt</title>
</head>
<body style="font-family:Arial,sans-serif;padding:20px;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
    <h2 style="margin:0 0 12px;">Payment Receipt</h2>
    <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px;">
      ${photoHtml}
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Retailer</span><strong>${retailer?.name ?? '-'}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>EMI Collected</span><strong>${fmt(Number(request.total_emi_amount || 0))}</strong></div>
        ${Number(request.fine_amount || 0) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Fine Paid</span><strong>${fmt(Number(request.fine_amount))}</strong></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Payment Mode</span><strong>${request.mode === 'UPI' ? 'UPI' : 'Cash'}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Total Paid</span><strong>${fmt(Number(request.total_amount || 0))}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Date/Time</span><strong>${format(new Date(request.created_at), 'd MMM yyyy, h:mm a')}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2e8f0;"><span>Status</span><strong>${request.status === 'APPROVED' ? 'Approved' : 'Pending'}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Next EMI Due Date</span><strong>${nextEmi?.due_date ? format(new Date(nextEmi.due_date), 'd MMM yyyy') : 'No further EMI due'}</strong></div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Disposition': `attachment; filename="receipt-${request.id}.html"`,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
