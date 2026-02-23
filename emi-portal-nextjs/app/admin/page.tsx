'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Customer, Retailer, EMISchedule, DueBreakdown } from '@/lib/types';
import NavBar from '@/components/NavBar';
import SearchInput from '@/components/SearchInput';
import CustomerDetailPanel from '@/components/CustomerDetailPanel';
import CustomerFormModal from '@/components/CustomerFormModal';
import EMIScheduleTable from '@/components/EMIScheduleTable';
import DueBreakdownPanel from '@/components/DueBreakdownPanel';
import PaymentModal from '@/components/PaymentModal';
import toast from 'react-hot-toast';
import { addDays, subMonths, format } from 'date-fns';

type Tab = 'search' | 'retailers' | 'reports';

interface FilteredEMI {
  id: string;
  emi_no: number;
  due_date: string;
  amount: number;
  status: string;
  fine_amount: number;
  customer_name: string;
  imei: string;
  mobile: string;
  retailer_name: string;
  customer_id: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

async function exportCSV(supabase: ReturnType<typeof createClient>, type: string) {
  toast('Generating report...', { icon: '📊' });
  let data: Record<string, unknown>[] = [];
  let filename = 'report.csv';

  if (type === 'customers') {
    const { data: rows } = await supabase
      .from('customers')
      .select('id,customer_name,father_name,mobile,imei,aadhaar,model_no,purchase_date,purchase_value,down_payment,emi_amount,emi_tenure,first_emi_charge_amount,first_emi_charge_paid_at,status,retailer:retailers(name)')
      .order('customer_name');
    data = (rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      retailer_name: (r.retailer as { name?: string } | null)?.name || '',
      retailer: undefined,
    }));
    filename = 'customers.csv';
  } else if (type === 'emi_schedule') {
    const { data: rows } = await supabase
      .from('emi_schedule')
      .select('emi_no,due_date,amount,status,paid_at,mode,fine_amount,fine_waived,customer:customers(customer_name,imei)')
      .order('due_date');
    data = (rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      customer_name: (r.customer as { customer_name?: string } | null)?.customer_name || '',
      imei: (r.customer as { imei?: string } | null)?.imei || '',
      customer: undefined,
    }));
    filename = 'emi_schedule.csv';
  } else if (type === 'upcoming') {
    const in30 = addDays(new Date(), 30).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const { data: rows } = await supabase
      .from('emi_schedule')
      .select('emi_no,due_date,amount,status,customer:customers(customer_name,imei,mobile,retailer:retailers(name))')
      .eq('status', 'UNPAID')
      .lte('due_date', in30)
      .gte('due_date', today)
      .order('due_date');
    data = (rows || []).map((r: Record<string, unknown>) => {
      const cust = r.customer as Record<string, unknown> | null;
      return {
        emi_no: r.emi_no, due_date: r.due_date, amount: r.amount,
        customer_name: cust?.customer_name || '',
        imei: cust?.imei || '',
        mobile: cust?.mobile || '',
        retailer: (cust?.retailer as { name?: string } | null)?.name || '',
      };
    });
    filename = 'upcoming_emis_30days.csv';
  } else if (type === 'fine_report') {
    const { data: rows } = await supabase
      .from('emi_schedule')
      .select('emi_no,due_date,amount,fine_amount,customer:customers(customer_name,imei,mobile)')
      .eq('status', 'UNPAID')
      .eq('fine_waived', false)
      .gt('fine_amount', 0);
    data = (rows || []).map((r: Record<string, unknown>) => {
      const cust = r.customer as Record<string, unknown> | null;
      return { emi_no: r.emi_no, due_date: r.due_date, emi_amount: r.amount, fine_due: r.fine_amount, customer_name: cust?.customer_name || '', imei: cust?.imei || '', mobile: cust?.mobile || '' };
    });
    filename = 'fine_due_report.csv';
  } else if (type === 'retailer_report') {
    const { data: rows } = await supabase
      .from('payment_requests')
      .select('created_at,total_amount,fine_amount,first_emi_charge_amount,mode,status,retailer:retailers(name),customer:customers(customer_name,imei)')
      .eq('status', 'APPROVED')
      .order('created_at', { ascending: false });
    data = (rows || []).map((r: Record<string, unknown>) => ({
      date: r.created_at, total: r.total_amount, fine: r.fine_amount, first_charge: r.first_emi_charge_amount, mode: r.mode,
      retailer: (r.retailer as { name?: string } | null)?.name || '',
      customer: (r.customer as { customer_name?: string } | null)?.customer_name || '',
      imei: (r.customer as { imei?: string } | null)?.imei || '',
    }));
    filename = 'retailer_collection_report.csv';
  }

  if (!data.length) { toast.error('No data to export'); return; }
  const headers = Object.keys(data[0]).filter(h => data[0][h] !== undefined);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded: ${filename}`);
}

export default function AdminDashboard() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('search');
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [searchResults, setSearchResults] = useState<Customer[] | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerEmis, setCustomerEmis] = useState<EMISchedule[]>([]);
  const [breakdown, setBreakdown] = useState<DueBreakdown | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeRemark, setCompleteRemark] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteRemark, setDeleteRemark] = useState('');
  const [showRetailerForm, setShowRetailerForm] = useState(false);
  const [editingRetailer, setEditingRetailer] = useState<Retailer | null>(null);
  const [retailerForm, setRetailerForm] = useState({ name: '', username: '', password: '', retail_pin: '' });
  const [fineSettings, setFineSettings] = useState({ default_fine_amount: 450 });
  const [pendingCount, setPendingCount] = useState(0);

  // Filter state
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filteredEmis, setFilteredEmis] = useState<FilteredEMI[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  // Stable refs so callbacks never capture stale closures
  const supabaseRef = useRef(supabase);
  supabaseRef.current = supabase;

  // selectCustomerRef always points to latest selectCustomerFn
  // so handleSearch (memoised with []) never calls a stale version
  const selectCustomerRef = useRef<(c: Customer) => Promise<void>>(async () => {});

  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    loadRetailers();
    loadFineSettings();
    loadPendingCount();
  }, []);

  async function loadPendingCount() {
    const { count } = await supabase.from('payment_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
    setPendingCount(count || 0);
  }

  async function loadRetailers() {
    const { data } = await supabase.from('retailers').select('*').order('name');
    setRetailers(data || []);
  }

  async function loadFineSettings() {
    const { data } = await supabase.from('fine_settings').select('*').eq('id', 1).single();
    if (data) setFineSettings(data);
  }

  const handleSearch = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setSearchResults(null);
      setSelectedCustomer(null);
      return;
    }
    setSearchLoading(true);
    try {
      const sb = supabaseRef.current;
      let qb = sb.from('customers').select('*, retailer:retailers(*)');
      if (/^\d{15}$/.test(query)) qb = qb.eq('imei', query);
      else if (/^\d{12}$/.test(query)) qb = qb.eq('aadhaar', query);
      else qb = qb.ilike('customer_name', `%${query}%`);

      const { data, error } = await qb.order('customer_name').limit(20);
      if (error) { console.error('Search error:', error); return; }
      const results = (data as Customer[]) || [];
      setSearchResults(results);
      if (results.length === 1) await selectCustomerRef.current(results[0]);
      else setSelectedCustomer(null);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  async function selectCustomerFn(customer: Customer) {
    setSelectedCustomer(customer);
    const sb = supabaseRef.current;
    const { data: emis } = await sb.from('emi_schedule').select('*').eq('customer_id', customer.id).order('emi_no');
    setCustomerEmis((emis as EMISchedule[]) || []);
    const { data: bd } = await sb.rpc('get_due_breakdown', { p_customer_id: customer.id });
    setBreakdown(bd as DueBreakdown);
  }

  // Always keep ref in sync with latest function
  selectCustomerRef.current = selectCustomerFn;

  async function refreshSelectedCustomer() {
    if (selectedCustomer) await selectCustomerFn(selectedCustomer);
  }

  async function handleMarkComplete() {
    if (!selectedCustomer || !completeRemark.trim()) { toast.error('Completion remark required'); return; }
    const { error } = await supabase.from('customers').update({
      status: 'COMPLETE',
      completion_remark: completeRemark,
      completion_date: new Date().toISOString().split('T')[0],
    }).eq('id', selectedCustomer.id);
    if (error) toast.error(error.message);
    else {
      toast.success('Marked as COMPLETE');
      setShowCompleteModal(false);
      setCompleteRemark('');
      await selectCustomerFn({ ...selectedCustomer, status: 'COMPLETE' });
    }
  }

  async function handleDeleteCustomer() {
    if (!selectedCustomer || !deleteRemark.trim()) { toast.error('Deletion reason required'); return; }
    const { error } = await supabase.from('customers').delete().eq('id', selectedCustomer.id);
    if (error) toast.error(error.message);
    else {
      toast.success('Customer deleted');
      setShowDeleteConfirm(false);
      setDeleteRemark('');
      setSelectedCustomer(null);
      setSearchResults(null);
    }
  }

  async function handleRetailerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const method = editingRetailer ? 'PATCH' : 'POST';
    const body = editingRetailer
      ? { id: editingRetailer.id, name: retailerForm.name, ...(retailerForm.password && { password: retailerForm.password }), ...(retailerForm.retail_pin && { retail_pin: retailerForm.retail_pin }) }
      : { name: retailerForm.name, username: retailerForm.username, password: retailerForm.password, retail_pin: retailerForm.retail_pin };

    const res = await fetch('/api/retailers', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) { toast.success(editingRetailer ? 'Retailer updated' : 'Retailer created'); loadRetailers(); setShowRetailerForm(false); }
    else toast.error(data.error);
  }

  async function handleDeleteRetailer(id: string) {
    if (!confirm('Delete this retailer? This cannot be undone.')) return;
    const res = await fetch(`/api/retailers?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) { toast.success('Retailer deleted'); loadRetailers(); }
    else toast.error(data.error);
  }

  async function handleToggleRetailerActive(r: Retailer) {
    const res = await fetch('/api/retailers', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, is_active: !r.is_active }),
    });
    if (res.ok) { toast.success(r.is_active ? 'Retailer deactivated' : 'Retailer activated'); loadRetailers(); }
  }

  async function updateFineSettings() {
    const { error } = await supabase.from('fine_settings').update({ default_fine_amount: fineSettings.default_fine_amount }).eq('id', 1);
    if (!error) toast.success('Fine settings updated');
    else toast.error(error.message);
  }

  async function loadFilter(filterKey: string, days?: number, months?: number) {
    setActiveFilter(filterKey);
    setFilteredEmis(null);
    setFilterLoading(true);

    try {
      let query = supabase
        .from('emi_schedule')
        .select(`
          id, emi_no, due_date, amount, status, fine_amount, fine_waived,
          customer:customers(id, customer_name, imei, mobile, retailer:retailers(name))
        `)
        .eq('status', 'UNPAID');

      const today = new Date();

      if (filterKey === 'fine_only') {
        query = query.gt('fine_amount', 0).eq('fine_waived', false);
      } else if (days) {
        const target = addDays(today, days).toISOString().split('T')[0];
        query = query.lte('due_date', target).gte('due_date', today.toISOString().split('T')[0]);
      } else if (months) {
        const cutoff = subMonths(today, months).toISOString().split('T')[0];
        query = query.lt('due_date', cutoff);
      }

      const { data, error } = await query.order('due_date').limit(100);
      if (error) { toast.error(error.message); return; }

      const mapped: FilteredEMI[] = (data || []).map((row: Record<string, unknown>) => {
        const cust = row.customer as Record<string, unknown> | null;
        return {
          id: row.id as string,
          emi_no: row.emi_no as number,
          due_date: row.due_date as string,
          amount: row.amount as number,
          status: row.status as string,
          fine_amount: row.fine_amount as number || 0,
          customer_name: (cust?.customer_name as string) || '',
          imei: (cust?.imei as string) || '',
          mobile: (cust?.mobile as string) || '',
          retailer_name: ((cust?.retailer as { name?: string } | null)?.name) || '',
          customer_id: (cust?.id as string) || '',
        };
      });
      setFilteredEmis(mapped);
    } finally {
      setFilterLoading(false);
    }
  }

  function clearFilter() {
    setActiveFilter(null);
    setFilteredEmis(null);
  }

  const paidCount = customerEmis.filter((e) => e.status === 'APPROVED').length;

  return (
    <div className="min-h-screen page-bg">
      <NavBar role="admin" userName="TELEPOINT" pendingCount={pendingCount} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mb-8 bg-surface-2 rounded-2xl p-1.5 border border-surface-4 w-fit">
          {([
            { key: 'search', label: '🔍 Customer Search' },
            { key: 'retailers', label: '🏪 Retailers' },
            { key: 'reports', label: '📊 Reports & Settings' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                tab === t.key ? 'bg-brand-500 text-ink shadow-lg shadow-brand-500/20' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ===== SEARCH TAB ===== */}
        {tab === 'search' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-display text-3xl font-bold text-ink">Customer Search</h1>
                <p className="text-ink-muted text-sm mt-1">Search all customers — RUNNING and COMPLETE</p>
              </div>
              <button onClick={() => { setEditingCustomer(null); setShowCustomerForm(true); }} className="btn-primary">
                + New Customer
              </button>
            </div>

            <SearchInput onSearch={handleSearch} loading={searchLoading} autoFocus />

            {searchResults === null && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 rounded-3xl bg-surface-2 border border-surface-4 flex items-center justify-center mb-5">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(232,184,0,0.4)" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </div>
                <p className="text-ink-muted text-lg">Enter name, IMEI, or Aadhaar to search</p>
                <p className="text-ink-muted text-sm mt-1">Results appear as you type — no button needed</p>
              </div>
            )}

            {searchResults !== null && searchResults.length === 0 && (
              <div className="text-center py-16">
                <p className="text-ink-muted">No customers found. Try a different search term.</p>
              </div>
            )}

            {searchResults !== null && searchResults.length > 1 && !selectedCustomer && (
              <div className="card overflow-hidden animate-fade-in">
                <div className="px-5 py-3 border-b border-surface-4">
                  <span className="text-xs text-ink-muted uppercase tracking-widest">{searchResults.length} customers found — click a row to view</span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr><th>Name</th><th>IMEI</th><th>Mobile</th><th>Retailer</th><th>Status</th><th>EMI/mo</th><th /></tr>
                  </thead>
                  <tbody>
                    {searchResults.map((c) => (
                      <tr key={c.id} onClick={() => selectCustomerFn(c)} className="cursor-pointer">
                        <td>
                          <p className="text-ink font-medium">{c.customer_name}</p>
                          {c.father_name && <p className="text-xs text-ink-muted">C/O {c.father_name}</p>}
                        </td>
                        <td><span className="font-num text-xs">{c.imei}</span></td>
                        <td><span className="font-num">{c.mobile}</span></td>
                        <td><span className="text-ink-muted">{(c.retailer as Retailer)?.name || '—'}</span></td>
                        <td>
                          {c.status === 'RUNNING'
                            ? <span className="badge-running">Running</span>
                            : <span className="badge-complete">Complete</span>}
                        </td>
                        <td><span className="font-num text-brand-600">{fmt(c.emi_amount)}</span></td>
                        <td>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-muted">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedCustomer && (
              <div className="space-y-5 animate-slide-up">
                {/* Action bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {searchResults && searchResults.length > 1 && (
                    <button onClick={() => setSelectedCustomer(null)} className="btn-ghost flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                      Back to results
                    </button>
                  )}
                  <div className="flex flex-wrap gap-2 ml-auto">
                    <button onClick={() => { setEditingCustomer(selectedCustomer); setShowCustomerForm(true); }} className="btn-ghost">
                      ✏️ Edit
                    </button>
                    {selectedCustomer.status === 'RUNNING' && (
                      <button onClick={() => setShowCompleteModal(true)} className="btn-success">
                        ✓ Mark Complete
                      </button>
                    )}
                    <button onClick={() => setShowPaymentModal(true)} className="btn-primary">
                      💳 Record Payment
                    </button>
                    <button onClick={() => setShowDeleteConfirm(true)} className="btn-danger">
                      🗑 Delete
                    </button>
                  </div>
                </div>

                <CustomerDetailPanel customer={selectedCustomer} paidCount={paidCount} totalEmis={selectedCustomer.emi_tenure} isAdmin={true} />
                {breakdown && <DueBreakdownPanel breakdown={breakdown} />}
                <EMIScheduleTable
                  emis={customerEmis}
                  nextUnpaidNo={breakdown?.next_emi_no ?? undefined}
                  isAdmin={true}
                  onRefresh={refreshSelectedCustomer}
                />
              </div>
            )}
          </div>
        )}

        {/* ===== RETAILERS TAB ===== */}
        {tab === 'retailers' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-display text-3xl font-bold text-ink">Retailer Management</h1>
                <p className="text-ink-muted text-sm mt-1">{retailers.length} retailers registered</p>
              </div>
              <button
                onClick={() => { setEditingRetailer(null); setRetailerForm({ name: '', username: '', password: '', retail_pin: '' }); setShowRetailerForm(true); }}
                className="btn-primary"
              >
                + Add Retailer
              </button>
            </div>

            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>Username</th><th>Status</th><th>Created</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {retailers.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-ink">{r.name}</td>
                      <td><span className="font-num text-ink-muted">@{r.username}</span></td>
                      <td>{r.is_active ? <span className="badge-running">Active</span> : <span className="badge-rejected">Inactive</span>}</td>
                      <td className="text-xs text-ink-muted">{format(new Date(r.created_at), 'd MMM yyyy')}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditingRetailer(r); setRetailerForm({ name: r.name, username: r.username, password: '', retail_pin: '' }); setShowRetailerForm(true); }}
                            className="px-3 py-1 text-xs border border-surface-4 hover:border-brand-300 hover:text-brand-600 rounded-lg transition-colors text-ink-muted"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleRetailerActive(r)}
                            className={`px-3 py-1 text-xs border rounded-lg transition-colors ${
                              r.is_active ? 'border-danger-border hover:border-danger text-danger' : 'border-success-border hover:border-jade-500/40 text-success'
                            }`}
                          >
                            {r.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => handleDeleteRetailer(r.id)}
                            className="px-3 py-1 text-xs border border-danger-border hover:border-danger text-danger rounded-lg transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {retailers.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-ink-muted py-10">No retailers yet. Add one to get started.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== REPORTS TAB ===== */}
        {tab === 'reports' && (
          <div className="space-y-6 animate-fade-in">
            <h1 className="font-display text-3xl font-bold text-ink">Reports & Settings</h1>

            {/* Fine Settings */}
            <div className="card p-6">
              <p className="section-header">Fine Settings</p>
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <label className="form-label">Default Late Fine Amount (₹)</label>
                  <input
                    type="number"
                    value={fineSettings.default_fine_amount}
                    onChange={(e) => setFineSettings((f) => ({ ...f, default_fine_amount: parseFloat(e.target.value) }))}
                    className="form-input"
                    min={0}
                  />
                </div>
                <button onClick={updateFineSettings} className="btn-primary">Save</button>
              </div>
              <p className="text-xs text-ink-muted mt-2">
                Default ₹450. Applies when the next unpaid EMI is past due. Can be waived or overridden per-EMI in the customer view.
              </p>
            </div>

            {/* Export Reports */}
            <div className="card p-6">
              <p className="section-header">Export Reports (CSV)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'All Customers', action: 'customers' },
                  { label: 'Full EMI Schedule', action: 'emi_schedule' },
                  { label: 'Retailer Collection', action: 'retailer_report' },
                  { label: 'Upcoming EMIs (30d)', action: 'upcoming' },
                  { label: 'Fine Due Report', action: 'fine_report' },
                ].map((item) => (
                  <button
                    key={item.action}
                    onClick={() => exportCSV(supabase, item.action)}
                    className="px-4 py-3 rounded-xl border border-surface-4 hover:border-brand-300 text-ink-muted hover:text-brand-600 text-sm font-medium transition-all text-left flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* EMI Filters */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="section-header mb-0">EMI Due Filters</p>
                {activeFilter && (
                  <button onClick={clearFilter} className="text-xs text-ink-muted hover:text-ink underline underline-offset-4 transition-colors">
                    Clear filter
                  </button>
                )}
              </div>

              {/* Upcoming due */}
              <p className="text-xs text-ink-muted mb-2 uppercase tracking-widest">Upcoming due date</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {[5, 10, 15, 20, 25, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => loadFilter(`upcoming_${d}`, d)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                      activeFilter === `upcoming_${d}`
                        ? 'bg-brand-500/20 border-brand-400 text-brand-600'
                        : 'border-surface-4 text-ink-muted hover:text-ink'
                    }`}
                  >
                    Next {d} days
                  </button>
                ))}
              </div>

              {/* Overdue by months */}
              <p className="text-xs text-ink-muted mb-2 uppercase tracking-widest">Overdue by months</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {[2, 3, 4, 5].map((m) => (
                  <button
                    key={m}
                    onClick={() => loadFilter(`months_${m}`, undefined, m)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                      activeFilter === `months_${m}`
                        ? 'bg-danger-light border-danger text-danger'
                        : 'border-surface-4 text-ink-muted hover:text-ink'
                    }`}
                  >
                    {m}+ months overdue
                  </button>
                ))}
              </div>

              {/* Fine only */}
              <button
                onClick={() => loadFilter('fine_only')}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  activeFilter === 'fine_only'
                    ? 'bg-danger-light border-danger text-danger'
                    : 'border-surface-4 text-ink-muted hover:text-ink'
                }`}
              >
                🔴 Fine Due Only
              </button>

              {/* Filter Results */}
              {filterLoading && (
                <div className="mt-6 flex items-center gap-3 text-ink-muted">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading filtered results...
                </div>
              )}

              {filteredEmis !== null && !filterLoading && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-ink-muted">
                      <span className="text-ink font-semibold">{filteredEmis.length}</span> EMIs found
                    </p>
                    {filteredEmis.length > 0 && (
                      <button
                        onClick={() => {
                          const csv = [
                            'customer_name,imei,mobile,retailer,emi_no,due_date,amount,fine_amount',
                            ...filteredEmis.map(r =>
                              [r.customer_name, r.imei, r.mobile, r.retailer_name, r.emi_no, r.due_date, r.amount, r.fine_amount].join(',')
                            )
                          ].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `filter_${activeFilter}.csv`; a.click();
                        }}
                        className="text-xs text-brand-600 hover:text-brand-600 underline underline-offset-4"
                      >
                        Export CSV
                      </button>
                    )}
                  </div>

                  {filteredEmis.length === 0 ? (
                    <p className="text-ink-muted text-sm py-4">No EMIs match this filter.</p>
                  ) : (
                    <div className="card overflow-hidden">
                      <table className="data-table">
                        <thead>
                          <tr><th>Customer</th><th>IMEI</th><th>Mobile</th><th>Retailer</th><th>EMI #</th><th>Due Date</th><th>Amount</th><th>Fine</th></tr>
                        </thead>
                        <tbody>
                          {filteredEmis.map((row) => (
                            <tr key={row.id}>
                              <td className="text-ink font-medium">{row.customer_name}</td>
                              <td><span className="font-num text-xs">{row.imei}</span></td>
                              <td><span className="font-num text-ink-muted">{row.mobile}</span></td>
                              <td className="text-ink-muted">{row.retailer_name}</td>
                              <td><span className="font-num">#{row.emi_no}</span></td>
                              <td>
                                <span className={`font-num text-xs ${new Date(row.due_date) < new Date() ? 'text-danger font-semibold' : 'text-ink-muted'}`}>
                                  {format(new Date(row.due_date), 'd MMM yyyy')}
                                </span>
                              </td>
                              <td><span className="font-num">{fmt(row.amount)}</span></td>
                              <td>
                                {row.fine_amount > 0
                                  ? <span className="font-num text-danger text-xs font-semibold">{fmt(row.fine_amount)}</span>
                                  : <span className="text-ink-muted text-xs">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== MODALS ===== */}

      {showCustomerForm && (
        <CustomerFormModal
          customer={editingCustomer}
          retailers={retailers}
          onClose={() => { setShowCustomerForm(false); setEditingCustomer(null); }}
          onSaved={refreshSelectedCustomer}
          isAdmin={true}
        />
      )}

      {showPaymentModal && selectedCustomer && breakdown && (
        <PaymentModal
          customer={selectedCustomer}
          emis={customerEmis}
          breakdown={breakdown}
          onClose={() => setShowPaymentModal(false)}
          onSubmitted={async () => { await refreshSelectedCustomer(); loadPendingCount(); }}
          isAdmin={true}
        />
      )}

      {showCompleteModal && (
        <div className="modal-backdrop">
          <div className="card w-full max-w-md p-6 animate-slide-up">
            <h3 className="font-display text-xl font-bold text-ink mb-2">Mark as COMPLETE</h3>
            <p className="text-sm text-ink-muted mb-5">
              Once complete, the retailer cannot collect further payments. Remark is mandatory.
            </p>
            <div className="mb-4">
              <label className="form-label">Completion Remark <span className="text-brand-600">*</span></label>
              <textarea
                value={completeRemark}
                onChange={(e) => setCompleteRemark(e.target.value)}
                rows={3}
                placeholder="e.g. All EMIs cleared, NOC issued"
                className="form-input resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCompleteModal(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={handleMarkComplete} className="btn-success flex-1">Confirm Complete</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="modal-backdrop">
          <div className="card w-full max-w-md p-6 animate-slide-up">
            <h3 className="font-display text-xl font-bold text-danger mb-2">⚠ Delete Customer</h3>
            <p className="text-sm text-ink-muted mb-5">
              This permanently deletes the customer, all EMI records, and payment history. This cannot be undone.
            </p>
            <div className="mb-4">
              <label className="form-label">Reason for Deletion <span className="text-brand-600">*</span></label>
              <input
                value={deleteRemark}
                onChange={(e) => setDeleteRemark(e.target.value)}
                placeholder="State the reason..."
                className="form-input"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={handleDeleteCustomer} className="btn-danger flex-1">Confirm Delete</button>
            </div>
          </div>
        </div>
      )}

      {showRetailerForm && (
        <div className="modal-backdrop">
          <div className="card w-full max-w-md p-6 animate-slide-up">
            <h3 className="font-display text-xl font-bold text-ink mb-5">
              {editingRetailer ? 'Edit Retailer' : 'Add New Retailer'}
            </h3>
            <form onSubmit={handleRetailerSubmit} className="space-y-4">
              <div>
                <label className="form-label">Display Name <span className="text-brand-600">*</span></label>
                <input
                  value={retailerForm.name}
                  onChange={(e) => setRetailerForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="e.g. Singh Mobiles"
                  className="form-input"
                />
              </div>
              {!editingRetailer && (
                <div>
                  <label className="form-label">Username <span className="text-brand-600">*</span></label>
                  <input
                    value={retailerForm.username}
                    onChange={(e) => setRetailerForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
                    required
                    placeholder="lowercase, no spaces"
                    className="form-input"
                  />
                  <p className="text-xs text-ink-muted mt-1">Login email will be: {retailerForm.username || 'username'}@retailer.local</p>
                </div>
              )}
              <div>
                <label className="form-label">
                  {editingRetailer ? 'New Password (leave blank to keep current)' : 'Password'} {!editingRetailer && <span className="text-brand-600">*</span>}
                </label>
                <input
                  type="password"
                  value={retailerForm.password}
                  onChange={(e) => setRetailerForm((f) => ({ ...f, password: e.target.value }))}
                  required={!editingRetailer}
                  placeholder="••••••••"
                  className="form-input"
                />
                {!editingRetailer && (
                  <p className="text-xs text-ink-muted mt-1">Used to log in to the retailer dashboard.</p>
                )}
              </div>
              <div>
                <label className="form-label">
                  Retail PIN <span className="text-brand-600">{!editingRetailer ? '*' : '(update)'}</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={retailerForm.retail_pin}
                  onChange={(e) => setRetailerForm((f) => ({ ...f, retail_pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                  required={!editingRetailer}
                  placeholder="4–6 digit PIN"
                  className="form-input"
                  maxLength={6}
                />
                <p className="text-xs text-ink-muted mt-1">
                  Separate from login password. Required every time retailer submits a payment.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowRetailerForm(false)} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1">{editingRetailer ? 'Update Retailer' : 'Create Retailer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
