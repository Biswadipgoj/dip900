import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(_: Request, { params }: { params: { customer_id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const service = createServiceClient();
  const { data: profile } = await service.from('profiles').select('role').eq('user_id', user.id).single();
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: customer } = await service.from('customers').select('*').eq('id', params.customer_id).single();
  if (!customer || customer.status !== 'COMPLETE') return NextResponse.json({ error: 'Completed customer required' }, { status: 400 });
  const html = `<!doctype html><html><body style="font-family:Arial;padding:20px"><h2>No Objection Certificate</h2><p>This is to certify that ${customer.customer_name} (${customer.mobile}) account is completed${customer.is_settled ? ' and settled' : ''}.</p></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="noc-${params.customer_id.slice(0,8)}.html"` } });
}
