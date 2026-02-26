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
  const { data: settlement } = await service.from('customer_settlements').select('*').eq('customer_id', params.customer_id).order('settled_at', { ascending: false }).limit(1).maybeSingle();
  if (!customer || !settlement) return NextResponse.json({ error: 'Settlement record not found' }, { status: 404 });

  const html = `<!doctype html><html><body style="font-family:Arial;padding:20px;color:#111827">
  <h2>Settlement Letter</h2>
  <p>Customer: <b>${customer.customer_name}</b> (${customer.mobile})</p>
  <p>IMEI: <b>${customer.imei}</b> | Retailer: ${(customer.retailer as { name?: string })?.name ?? '-'} (${(customer.retailer as { mobile?: string })?.mobile ?? '-'})</p>
  <p>Settlement Amount Collected: <b>${fmt(settlement.settlement_amount_collected)}</b></p>
  <p>Settlement Date: <b>${format(new Date(settlement.settlement_date), 'd MMM yyyy')}</b></p>
  <p>Note: ${settlement.note || '-'}</p>
  <p>This account is settled/closed.</p>
  <p>Prepared by Super Admin (${user.email}) at ${format(new Date(), 'd MMM yyyy, h:mm a')}</p>
  </body></html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="settlement-letter-${customer.imei}.html"`,
      'Cache-Control': 'no-store',
    },
  });
}
