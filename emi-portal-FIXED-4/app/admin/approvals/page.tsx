'use client';

import { useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PaymentRequest } from '@/lib/types';
import NavBar from '@/components/NavBar';
import SearchInput from '@/components/SearchInput';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import Link from 'next/link';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0,
  }).format(n);
}

export default function ApprovalsPage() {
  const supabase = createClient();
  const supabaseRef = useRef(supabase);
  supabaseRef.current = supabase;

  const [searchQuery, setSearchQuery] = useState('');
  const [requests, setRequests] = useState<PaymentRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveRemark, setApproveRemark] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'ALL'>('PENDING');

  const [editModal, setEditModal] = useState<PaymentRequest | null>(null);
  const [editForm, setEditForm] = useState({
    status: '', mode: '', total_emi_amount: '', fine_amount: '',
    first_emi_charge_amount: '', total_amount: '', notes: '',
    paid_at: '', collected_by_role: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const fetchPending = useCallback(async (query?: string, filter?: 'PENDING' | 'ALL') => {
    const sb = supabaseRef.current;
    setLoading(true);
    try {
      let qb = sb
        .from('payment_requests')
        .select(`
          *,
          customer:customers(id, customer_name, imei, mobile, first_emi_charge_amount, first_emi_charge_paid_at),
          retailer:retailers(id, name, username)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      const useFilter = filter ?? statusFilter;
      if (useFilter === 'PENDING') {
        qb = qb.eq('status', 'PENDING');
      }

      if (query && query.length >= 3) {
        const isMobile = /^\d{10}$/.test(query);
        const isIMEI = /^\d{15}$/.test(query);
        const isAadhaar = /^\d{12}$/.test(query);

        if (isIMEI) {
          const { data: cust } = await sb.from('customers').select('id').eq('imei', query).single();
          if (cust) qb = qb.eq('customer_id', cust.id);
          else { setRequests([]); return; }
        } else if (isAadhaar) {
          const { data: cust } = await sb.from('customers').select('id').eq('aadhaar', query).single();
          if (cust) qb = qb.eq('customer_id', cust.id);
          else { setRequests([]); return; }
        } else if (isMobile) {
          const { data: custs } = await sb.from('customers').select('id').eq('mobile', query);
          const ids = (custs || []).map(c => c.id);
          if (ids.length === 0) { setRequests([]); return; }
          qb = qb.in('customer_id', ids);
        } else {
          // Try name search first, also search UTR
          const { data: custs } = await sb.from('customers').select('id').ilike('customer_name', `%${query}%`);
          const nameIds = (custs || []).map(c => c.id);
          // Also search UTR in payment_requests
          if (nameIds.length > 0) {
            qb = qb.or(`customer_id.in.(${nameIds.join(',')}),utr.ilike.%${query.trim()}%,notes.ilike.%${query.trim()}%`);
          } else {
            qb = qb.or(`utr.ilike.%${query.trim()}%,notes.ilike.%${query.trim()}%`);
          }
        }
      }

      const { data, error } = await qb;
      if (error) { console.error('Fetch pending error:', error); toast.error('Failed to load requests'); return; }
      setRequests((data as PaymentRequest[]) || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 3) { setRequests(null); return; }
    fetchPending(query);
  }, [fetchPending]);

  function loadAllPending() {
    setSearchQuery('');
    fetchPending(undefined, statusFilter);
  }

  function openEditModal(req: PaymentRequest) {
    setEditForm({
      status: req.status, mode: req.mode,
      total_emi_amount: String(req.total_emi_amount || 0),
      fine_amount: String(req.fine_amount || 0),
      first_emi_charge_amount: String(req.first_emi_charge_amount || 0),
      total_amount: String(req.total_amount || 0),
      notes: req.notes || '',
      paid_at: req.approved_at ? req.approved_at.split('T')[0] : '',
      collected_by_role: '',
    });
    setEditModal(req);
  }

  async function savePaymentEdit() {
    if (!editModal) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/payments/${editModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editForm.status, mode: editForm.mode,
          total_emi_amount: parseFloat(editForm.total_emi_amount) || 0,
          fine_amount: parseFloat(editForm.fine_amount) || 0,
          first_emi_charge_amount: parseFloat(editForm.first_emi_charge_amount) || 0,
          total_amount: parseFloat(editForm.total_amount) || 0,
          notes: editForm.notes || null,
          paid_at: editForm.paid_at || null,
          collected_by_role: editForm.collected_by_role || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Payment updated');
        setEditModal(null);
        fetchPending(searchQuery || undefined, statusFilter);
      } else {
        toast.error(data.error || 'Failed to update');
      }
    } finally { setEditSaving(false); }
  }

  async function handleApprove(requestId: string) {
    setActionLoading(requestId);
    const toastId = toast.loading('Approving payment…');
    try {
      const res = await fetch('/api/admin/approve-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, remark: approveRemark }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Approval failed', { id: toastId });
        return;
      }
      toast.success('Payment approved successfully ✓', { id: toastId, duration: 4000 });
      setApprovingId(null);
      setApproveRemark('');
      setRequests(prev => (prev ?? []).filter(r => r.id !== requestId));
      setTimeout(() => fetchPending(searchQuery || undefined), 800);
    } catch (err) {
      console.error('Approve error:', err);
      toast.error('Network error', { id: toastId });
    } finally { setActionLoading(null); }
  }

  async function handleReject() {
    if (!rejectModal || !rejectReason.trim()) { toast.error('Rejection reason is required'); return; }
    setActionLoading(rejectModal.id);
    const toastId = toast.loading('Rejecting…');
    try {
      const res = await fetch('/api/payments/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: rejectModal.id, reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed', { id: toastId }); return; }
      toast.success('Payment rejected', { id: toastId });
      setRequests(prev => (prev ?? []).filter(r => r.id !== rejectModal.id));
      setRejectModal(null); setRejectReason('');
      setTimeout(() => fetchPending(searchQuery || undefined), 800);
    } catch (err) {
      console.error('Reject error:', err);
      toast.error('Network error', { id: toastId });
    } finally { setActionLoading(null); }
  }

  return (
    <div className="min-h-screen page-bg">
      <NavBar role="admin" userName="TELEPOINT" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">Payment Approvals</h1>
            <p className="text-ink-muted text-sm mt-1">Review and approve retailer payment requests</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-surface-2 rounded-xl p-1 border border-surface-4">
              <button onClick={() => { setStatusFilter('PENDING'); fetchPending(searchQuery || undefined, 'PENDING'); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === 'PENDING' ? 'bg-brand-500 text-ink shadow' : 'text-ink-muted'}`}>Pending</button>
              <button onClick={() => { setStatusFilter('ALL'); fetchPending(searchQuery || undefined, 'ALL'); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === 'ALL' ? 'bg-brand-500 text-ink shadow' : 'text-ink-muted'}`}>All Payments</button>
            </div>
            <button onClick={loadAllPending} disabled={loading} className="btn-ghost flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
              </svg>
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>

        <div className="mb-6">
          <SearchInput value={searchQuery} onChange={handleSearch}
            placeholder="Search by customer name, IMEI, mobile, Aadhaar, or UTR…" loading={loading} />
        </div>

        {requests === null && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-20 h-20 rounded-3xl bg-surface-2 border border-surface-4 flex items-center justify-center mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <p className="text-ink-muted text-lg">Search for requests or click &quot;Load&quot;</p>
          </div>
        )}
        {requests !== null && requests.length === 0 && !loading && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-success"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <p className="text-success font-semibold text-lg">All caught up!</p>
            <p className="text-ink-muted text-sm mt-1">No pending payment requests.</p>
          </div>
        )}
        {requests !== null && requests.length > 0 && (
          <div className="space-y-4">
            {requests.map(req => {
              const customer = req.customer as { customer_name?: string; imei?: string; mobile?: string; first_emi_charge_amount?: number; first_emi_charge_paid_at?: string };
              const retailer = req.retailer as { name?: string; username?: string };
              const hasFirstCharge = (req.first_emi_charge_amount ?? 0) > 0;
              const isActioning = actionLoading === req.id;
              return (
                <div key={req.id} className={`card p-5 animate-fade-in transition-opacity ${isActioning ? 'opacity-60 pointer-events-none' : ''}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-display text-lg font-semibold text-ink">{customer?.customer_name}</h3>
                        {req.status === 'PENDING' && <span className="badge-pending">● PENDING</span>}
                        {req.status === 'APPROVED' && <span className="badge-approved">✓ APPROVED</span>}
                        {req.status === 'REJECTED' && <span className="badge-rejected">✕ REJECTED</span>}
                        {hasFirstCharge && <span className="badge bg-warning-light text-warning border border-warning-border text-xs px-2 py-0.5 rounded-full">⚠ 1st Charge</span>}
                      </div>
                      <p className="text-xs text-ink-muted mt-1">
                        IMEI: <span className="font-num">{customer?.imei}</span>
                        {customer?.mobile && <> · <span className="font-num">{customer.mobile}</span></>}
                        {' · '}<strong>{retailer?.name}</strong>
                        {' · '}{format(new Date(req.created_at), 'd MMM yyyy, h:mm a')}
                      </p>
                      {req.selected_emi_nos?.length ? <p className="text-xs text-ink-muted mt-0.5">EMI #{req.selected_emi_nos.join(', #')}</p> : null}
                      {req.utr && <p className="text-xs text-info mt-0.5">UTR: <span className="font-num font-semibold">{req.utr}</span></p>}
                    </div>
                    <Link href={`/receipt/${req.id}`} target="_blank" className="text-xs text-info underline underline-offset-4 shrink-0">Receipt →</Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="bg-surface-2 rounded-xl p-3"><p className="text-xs text-ink-muted mb-1">EMI</p><p className="num font-semibold text-ink">{fmt(req.total_emi_amount)}</p></div>
                    {(req.fine_amount ?? 0) > 0 && <div className="bg-danger-light border border-danger-border rounded-xl p-3"><p className="text-xs text-danger mb-1">Fine</p><p className="num font-semibold text-danger">{fmt(req.fine_amount)}</p></div>}
                    {hasFirstCharge && <div className="bg-brand-50 border border-brand-200 rounded-xl p-3"><p className="text-xs text-brand-600 mb-1">1st Charge</p><p className="num font-semibold text-brand-600">{fmt(req.first_emi_charge_amount)}</p></div>}
                    <div className="bg-success-light border border-success-border rounded-xl p-3"><p className="text-xs text-success mb-1">Total</p><p className="num font-bold text-success">{fmt(req.total_amount)}</p></div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-muted mb-4">
                    <span className={`font-bold ${req.mode === 'UPI' ? 'text-info' : 'text-success'}`}>{req.mode}</span>
                    {req.notes && <span>· {req.notes}</span>}
                  </div>
                  <div className="flex gap-3 flex-wrap items-center">
                    <button onClick={() => openEditModal(req)} className="btn-ghost flex items-center gap-1.5 text-sm">✏️ Edit</button>
                    {req.status === 'PENDING' && approvingId !== req.id && (
                      <>
                        <button onClick={() => setApprovingId(req.id)} className="btn-success flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>Approve
                        </button>
                        <button onClick={() => { setRejectModal({ id: req.id }); setRejectReason(''); }} className="btn-danger flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>Reject
                        </button>
                      </>
                    )}
                    {req.status === 'PENDING' && approvingId === req.id && (
                      <div className="flex gap-3 items-end flex-wrap w-full mt-2">
                        <div className="flex-1 min-w-[200px]">
                          <label className="label text-xs mb-1 block">Remark (optional)</label>
                          <input value={approveRemark} onChange={e => setApproveRemark(e.target.value)} placeholder="Optional note…" className="input" autoFocus onKeyDown={e => e.key === 'Enter' && handleApprove(req.id)} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleApprove(req.id)} disabled={isActioning} className="btn-primary">{isActioning ? 'Approving…' : 'Confirm ✓'}</button>
                          <button onClick={() => { setApprovingId(null); setApproveRemark(''); }} className="btn-ghost">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {rejectModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRejectModal(null)}>
          <div className="card w-full max-w-md p-6 animate-slide-up shadow-modal">
            <h3 className="font-display text-xl font-bold text-danger mb-1">Reject Payment</h3>
            <p className="text-sm text-ink-muted mb-4">EMIs will revert to UNPAID.</p>
            <div className="mb-5">
              <label className="label">Reason <span className="text-danger">*</span></label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="e.g. Amount mismatch…" className="input resize-none" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={handleReject} disabled={actionLoading === rejectModal.id} className="btn-danger flex-1">
                {actionLoading === rejectModal.id ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className="card w-full max-w-lg p-6 animate-slide-up shadow-modal max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl font-bold text-ink mb-1">Edit Payment Record</h3>
            <p className="text-sm text-ink-muted mb-5">#{editModal.id.slice(0, 8).toUpperCase()} — {(editModal.customer as Record<string, unknown>)?.customer_name as string || 'Customer'}</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Status</label><select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className="input"><option value="PENDING">PENDING</option><option value="APPROVED">APPROVED</option><option value="REJECTED">REJECTED</option></select></div>
                <div><label className="label">Mode</label><select value={editForm.mode} onChange={e => setEditForm(f => ({ ...f, mode: e.target.value }))} className="input"><option value="CASH">CASH</option><option value="UPI">UPI</option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">EMI (₹)</label><input type="number" value={editForm.total_emi_amount} onChange={e => setEditForm(f => ({ ...f, total_emi_amount: e.target.value }))} className="input" /></div>
                <div><label className="label">Fine (₹)</label><input type="number" value={editForm.fine_amount} onChange={e => setEditForm(f => ({ ...f, fine_amount: e.target.value }))} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">1st Charge (₹)</label><input type="number" value={editForm.first_emi_charge_amount} onChange={e => setEditForm(f => ({ ...f, first_emi_charge_amount: e.target.value }))} className="input" /></div>
                <div><label className="label">Total (₹)</label><input type="number" value={editForm.total_amount} onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Paid Date</label><input type="date" value={editForm.paid_at} onChange={e => setEditForm(f => ({ ...f, paid_at: e.target.value }))} className="input" /></div>
                <div><label className="label">Collected By</label><select value={editForm.collected_by_role} onChange={e => setEditForm(f => ({ ...f, collected_by_role: e.target.value }))} className="input"><option value="">— Keep —</option><option value="admin">Admin</option><option value="retailer">Retailer</option></select></div>
              </div>
              <div><label className="label">Notes</label><textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input resize-none" /></div>
              <div className="bg-surface-2 rounded-xl p-3 text-xs text-ink-muted space-y-1">
                <p>EMIs: #{editModal.selected_emi_nos?.join(', #') || '—'}</p>
                <p>Retailer: {(editModal.retailer as Record<string, unknown>)?.name as string || '—'}</p>
                <p>Created: {format(new Date(editModal.created_at), 'd MMM yyyy, h:mm a')}</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={savePaymentEdit} disabled={editSaving} className="btn-primary flex-1">{editSaving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
