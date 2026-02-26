import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { format } from 'date-fns';

export async function GET(_: Request, { params }: { params: { customer_id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data: customer } = await service.from('customers').select('*, retailer:retailers(name,mobile)').eq('id', params.customer_id).single();
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (customer.status !== 'COMPLETE') return NextResponse.json({ error: 'NOC allowed only for completed customers' }, { status: 400 });

  const html = `<!doctype html><html><body style="font-family:Arial;padding:20px">
  <h2>NO OBJECTION CERTIFICATE ${customer.is_settled ? '(SETTLED)' : ''}</h2>
  <p>This is to certify that <b>${customer.customer_name}</b> (${customer.mobile}) has completed/settled EMI dues for IMEI <b>${customer.imei}</b>.</p>
  <p>Retailer: ${(customer.retailer as { name?: string })?.name ?? '-'} (${(customer.retailer as { mobile?: string })?.mobile ?? '-'})</p>
  <p>Date: ${format(new Date(), 'd MMM yyyy')}</p>
  </body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="noc-${customer.imei}.html"` } });
}
