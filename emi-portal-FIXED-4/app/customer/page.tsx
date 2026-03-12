'use client';

import { useState, useEffect } from 'react';
import { Customer, EMISchedule, DueBreakdown } from '@/lib/types';
import { format, differenceInDays } from 'date-fns';
import toast from 'react-hot-toast';
import { getPerEmiFineBreakdown, calculateTotalFineFromEmis } from '@/lib/fineCalc';

const SESSION_KEY = 'emi_customer_session';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

interface CustomerSession {
  customer: Customer;
  emis: EMISchedule[];
  breakdown: DueBreakdown | null;
}

interface MultiLoanEntry {
  id: string;
  customer_name: string;
  imei: string;
  model_no?: string;
  mobile: string;
  status: string;
  emi_amount: number;
  retailer?: { name?: string; mobile?: string };
}

export default function CustomerPortal() {
  const [aadhaar, setAadhaar] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [showUpcomingAlert, setShowUpcomingAlert] = useState(false);
  // Multi-loan selection
  const [multiLoans, setMultiLoans] = useState<MultiLoanEntry[] | null>(null);
  const [loadingLoan, setLoadingLoan] = useState(false);
  // Broadcast messages
  const [broadcastMessages, setBroadcastMessages] = useState<{ id: string; message: string; image_url?: string | null; expires_at: string; sender_name?: string; sender_role?: string }[]>([]);
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState<Set<string>>(new Set());

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as CustomerSession;
        setSession(parsed);
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  // Check upcoming EMI alert when session loads
  useEffect(() => {
    if (!session) return;
    const { breakdown } = session;
    if (!breakdown?.next_emi_due_date) return;
    const daysUntilDue = differenceInDays(new Date(breakdown.next_emi_due_date), new Date());
    if (daysUntilDue >= 0 && daysUntilDue <= 5) {
      setShowUpcomingAlert(true);
    }
  }, [session]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!aadhaar && !mobile) { toast.error('Enter Aadhaar or mobile number'); return; }
    if (aadhaar && aadhaar.length !== 12) { toast.error('Aadhaar must be 12 digits'); return; }
    if (mobile && mobile.length !== 10) { toast.error('Mobile must be 10 digits'); return; }

    setLoading(true);
    setMultiLoans(null);
    try {
      const res = await fetch('/api/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar: aadhaar || undefined, mobile: mobile || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }

      // Multi-loan: show selection list
      if (data.multi && data.customers) {
        setMultiLoans(data.customers);
        return;
      }

      const newSession: CustomerSession = {
        customer: data.customer,
        emis: data.emis,
        breakdown: data.breakdown,
      };
      setSession(newSession);
      if (data.broadcasts?.length) setBroadcastMessages(data.broadcasts);
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function selectLoan(customerId: string) {
    setLoadingLoan(true);
    try {
      const res = await fetch('/api/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      const newSession: CustomerSession = {
        customer: data.customer,
        emis: data.emis,
        breakdown: data.breakdown,
      };
      setSession(newSession);
      setMultiLoans(null);
      if (data.broadcasts?.length) setBroadcastMessages(data.broadcasts);
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setLoadingLoan(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setShowUpcomingAlert(false);
    setMultiLoans(null);
    localStorage.removeItem(SESSION_KEY);
    setAadhaar('');
    setMobile('');
  }

  const { customer, emis, breakdown } = session ?? { customer: null, emis: [], breakdown: null };
  const paidEmis = emis.filter(e => e.status === 'APPROVED');
  const unpaidEmis = emis.filter(e => e.status === 'UNPAID');
  const nextUnpaidEmi = unpaidEmis[0];
  const daysUntilDue = nextUnpaidEmi
    ? differenceInDays(new Date(nextUnpaidEmi.due_date), new Date())
    : null;

  if (!session) {
    // Multi-loan selection screen
    if (multiLoans && multiLoans.length > 0) {
      return (
        <div className="min-h-screen page-bg flex items-center justify-center p-4">
          <div className="relative w-full max-w-md animate-slide-up">
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl font-bold text-ink">Select Your Account</h1>
              <p className="text-slate-500 text-sm mt-1">Multiple EMI accounts found. Tap to view details.</p>
            </div>
            <div className="space-y-3">
              {multiLoans.map((loan) => (
                <button
                  key={loan.id}
                  onClick={() => selectLoan(loan.id)}
                  disabled={loadingLoan}
                  className="card w-full p-4 text-left hover:border-brand-400 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-ink">{loan.customer_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{loan.model_no || 'Device'} · IMEI: {loan.imei}</p>
                      <p className="text-xs text-slate-500">Retailer: {loan.retailer?.name || '—'}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        loan.status === 'RUNNING' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {loan.status}
                      </span>
                      <p className="text-sm font-semibold text-ink mt-1">{fmt(loan.emi_amount)}/mo</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => { setMultiLoans(null); }}
              className="btn-ghost w-full mt-4 py-2.5"
            >
              ← Back to Login
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen page-bg flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-sapphire-500/5 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-gold-500/5 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md animate-slide-up">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sapphire-500/10 border border-sapphire-500/20 mb-5">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
            </div>
            <h1 className="font-display text-3xl font-bold text-ink tracking-wide">Customer Portal</h1>
            <p className="text-slate-500 text-sm mt-1">View your EMI plan and payment history</p>
          </div>

          <div className="card p-8 shadow-2xl shadow-black/40">
            <p className="text-xs text-slate-500 text-center mb-6 tracking-wide">
              Login using Aadhaar <span className="text-slate-400">OR</span> mobile number
            </p>
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="form-label">Aadhaar Number <span className="text-slate-400 font-normal">(optional if mobile provided)</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={aadhaar}
                  onChange={e => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="12-digit Aadhaar number"
                  className="form-input"
                  autoFocus
                />
              </div>
              <div>
                <label className="form-label">Mobile Number <span className="text-slate-400 font-normal">(optional if Aadhaar provided)</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  className="form-input"
                />
              </div>
              <p className="text-xs text-slate-500">
                💡 Provide at least one. If multiple accounts share a mobile, use Aadhaar for precise login.
              </p>
              <button
                type="submit"
                disabled={loading || (!aadhaar && !mobile)}
                className="btn-primary w-full py-3.5 text-base mt-2"
              >
                {loading ? 'Verifying...' : 'View My Account'}
              </button>
            </form>

            <div className="gold-line" />
            <p className="text-center text-xs text-slate-600">
              Read-only access · TelePoint EMI Portal
            </p>
          </div>

          <div className="text-center mt-6">
            <a href="/login" className="text-xs text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-4">
              Staff login →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg">
      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-surface-4 bg-white/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sapphire-500/15 border border-sapphire-500/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
            </div>
            <span className="font-display text-base font-semibold text-ink">My Account</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 hidden sm:block">{customer?.customer_name}</span>
            <button onClick={() => { setSession(null); localStorage.removeItem(SESSION_KEY); }} className="text-xs text-slate-500 hover:text-brand-400 transition-colors border border-white/[0.08] px-3 py-1.5 rounded-lg">
              Switch
            </button>
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-crimson-400 transition-colors border border-white/[0.08] px-3 py-1.5 rounded-lg">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* 📢 Broadcast Message Popup */}
        {broadcastMessages.filter(b => !dismissedBroadcasts.has(b.id) && new Date(b.expires_at) > new Date()).map(b => (
          <div key={b.id} className="animate-fade-in relative" style={{ background: b.sender_role === 'retailer' ? 'linear-gradient(135deg, #dcfce7, #f0fdf4)' : 'linear-gradient(135deg, #dbeafe, #eff6ff)', border: b.sender_role === 'retailer' ? '2px solid #86efac' : '2px solid #93c5fd', borderRadius: '1rem', padding: '1.25rem' }}>
            <button
              onClick={() => setDismissedBroadcasts(prev => new Set([...prev, b.id]))}
              style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: b.sender_role === 'retailer' ? '#16a34a' : '#1d4ed8', fontSize: '1rem' }}
            >✕</button>
            <div className="flex items-start gap-3">
              <span className="text-3xl">{b.sender_role === 'retailer' ? '🏪' : '📢'}</span>
              <div>
                <p style={{ fontWeight: 700, color: b.sender_role === 'retailer' ? '#16a34a' : '#1d4ed8', marginBottom: '0.25rem' }}>
                  Message from {b.sender_name || 'TELEPOINT'}
                </p>
                <p style={{ fontSize: '0.9rem', color: b.sender_role === 'retailer' ? '#15803d' : '#1e40af', lineHeight: 1.5 }}>
                  {b.message}
                </p>
                {b.image_url && (
                  <img src={b.image_url} alt="Broadcast" style={{ marginTop: '0.75rem', maxHeight: '150px', borderRadius: '0.75rem', objectFit: 'cover', border: b.sender_role === 'retailer' ? '1px solid #86efac' : '1px solid #93c5fd' }} />
                )}
              </div>
            </div>
          </div>
        ))}

        {/* 🔔 Upcoming EMI Alert Popup */}
        {showUpcomingAlert && nextUnpaidEmi && daysUntilDue !== null && daysUntilDue <= 5 && (
          <div className="animate-fade-in relative" style={{ background: 'linear-gradient(135deg, #fef3c7, #fff7ed)', border: '2px solid #fcd34d', borderRadius: '1rem', padding: '1.25rem' }}>
            <button
              onClick={() => setShowUpcomingAlert(false)}
              style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: '1rem' }}
            >✕</button>
            <div className="flex items-start gap-3">
              <span className="text-3xl">🔔</span>
              <div>
                <p style={{ fontWeight: 700, color: '#92400e', marginBottom: '0.25rem' }}>
                  {daysUntilDue === 0 ? 'EMI Due Today!' : `EMI Due in ${daysUntilDue} Day${daysUntilDue !== 1 ? 's' : ''}!`}
                </p>
                <p style={{ fontSize: '0.875rem', color: '#92400e', opacity: 0.8 }}>
                  EMI #{nextUnpaidEmi.emi_no} — Due: {format(new Date(nextUnpaidEmi.due_date), 'd MMM yyyy')}
                </p>
                {breakdown && breakdown.total_payable > 0 && (
                  <div style={{ marginTop: '0.75rem', background: 'rgba(255,255,255,0.6)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#78350f' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>EMI #{nextUnpaidEmi.emi_no}</span>
                      <span>{fmt(nextUnpaidEmi.amount)}</span>
                    </div>
                    {breakdown.fine_due > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991b1b' }}>
                        <span>Late Fine</span>
                        <span>{fmt(breakdown.fine_due)}</span>
                      </div>
                    )}
                    {breakdown.first_emi_charge_due > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>1st EMI Charge</span>
                        <span>{fmt(breakdown.first_emi_charge_due)}</span>
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: '0.25rem', paddingTop: '0.25rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>Total Due</span>
                      <span>{fmt(breakdown.total_payable)}</span>
                    </div>
                  </div>
                )}
                <p style={{ fontSize: '0.75rem', color: '#92400e', opacity: 0.7, marginTop: '0.5rem' }}>Contact your retailer to make a payment.</p>
              </div>
            </div>
          </div>
        )}

        {/* 1st EMI Charge alert */}
        {breakdown?.popup_first_emi_charge && (
          <div className="alert-gold animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-gold-300 font-semibold">1st EMI Charge Pending</p>
                <p className="text-gold-400/70 text-sm mt-0.5">
                  A one-time charge of {fmt(breakdown.first_emi_charge_due)} is due. Contact your retailer to pay.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Fine alert */}
        {breakdown?.popup_fine_due && (
          <div className="alert-red animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔴</span>
              <div>
                <p className="text-crimson-300 font-semibold">Late Fine Due</p>
                <p className="text-crimson-400/70 text-sm mt-0.5">
                  A late fine of {fmt(breakdown.fine_due)} applies. Contact your retailer.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Profile card */}
        <div className="card overflow-hidden">
          <div className="flex items-start gap-4 p-5">
            {customer?.customer_photo_url ? (
              <img
                src={customer.customer_photo_url}
                alt="Photo"
                className="w-20 h-20 rounded-2xl object-cover border border-white/10 flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-surface-3 border border-white/10 flex items-center justify-center flex-shrink-0">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-2xl font-bold text-ink">{customer?.customer_name}</h2>
              {customer?.father_name && <p className="text-slate-500 text-sm">C/O {customer.father_name}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                <span className={customer?.status === 'COMPLETE' ? 'badge-complete' : 'badge-running'}>
                  {customer?.status === 'COMPLETE' ? '✓ Complete' : '● Running'}
                </span>
                {customer?.model_no && <span className="text-xs text-slate-500 bg-surface-3 px-2 py-0.5 rounded-full">{customer.model_no}</span>}
              </div>
            </div>
          </div>
          <div className="border-t border-surface-4 px-5 py-4 grid grid-cols-2 gap-4">
            <Field label="Mobile" value={customer?.mobile || ''} mono />
            <Field label="IMEI" value={customer?.imei || ''} mono />
            <Field label="Purchase Date" value={customer?.purchase_date ? format(new Date(customer.purchase_date), 'd MMM yyyy') : ''} />
            <Field label="Purchase Value" value={fmt(customer?.purchase_value || 0)} mono />
            <Field label="Down Payment" value={fmt(customer?.down_payment || 0)} mono />
            {customer?.disburse_amount && <Field label="Financed" value={fmt(customer.disburse_amount)} mono />}
          </div>
        </div>

        {/* EMI Plan */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-4 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">My EMI Plan</span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-jade-400 font-semibold">{paidEmis.length} paid</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">{emis.length} total</span>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-surface-4">
            <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
              <span>EMI Progress</span>
              <span className="font-num">{fmt(customer?.emi_amount || 0)} / month</span>
            </div>
            <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-jade-500 to-jade-400 rounded-full transition-all duration-700"
                style={{ width: `${emis.length > 0 ? (paidEmis.length / emis.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="divide-y divide-white/[0.03]">
            {emis.map(emi => {
              const isOverdue = emi.status === 'UNPAID' && new Date(emi.due_date) < new Date();
              const daysLeft = differenceInDays(new Date(emi.due_date), new Date());
              const isUpcoming = emi.status === 'UNPAID' && daysLeft >= 0 && daysLeft <= 5;
              return (
                <div key={emi.id} className={`flex items-center justify-between px-5 py-3.5 ${isOverdue ? 'bg-crimson-500/5' : isUpcoming ? 'bg-yellow-50/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      emi.status === 'APPROVED' ? 'bg-jade-500/20 text-jade-400' :
                      emi.status === 'PENDING_APPROVAL' ? 'bg-gold-500/20 text-gold-400' :
                      isOverdue ? 'bg-crimson-500/20 text-crimson-400' :
                      isUpcoming ? 'bg-yellow-100 text-yellow-700' : 'bg-surface-3 text-slate-500'
                    }`}>
                      {emi.emi_no}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${emi.status === 'APPROVED' ? 'text-jade-400' : isOverdue ? 'text-crimson-300' : 'text-ink'}`}>
                        EMI #{emi.emi_no}
                        {isUpcoming && !isOverdue && <span className="ml-1 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-bold">DUE SOON</span>}
                      </p>
                      <p className={`text-xs font-num ${isOverdue ? 'text-crimson-400' : 'text-slate-500'}`}>
                        Due: {format(new Date(emi.due_date), 'd MMM yyyy')}
                        {isOverdue && ' — OVERDUE'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-num text-sm text-ink">{fmt(emi.amount)}</p>
                    <div>
                      {emi.status === 'APPROVED' && <span className="text-[10px] text-jade-400 font-semibold">✓ PAID</span>}
                      {emi.status === 'PENDING_APPROVAL' && <span className="text-[10px] text-gold-400 font-semibold">⏳ PENDING</span>}
                      {emi.status === 'UNPAID' && <span className="text-[10px] text-slate-500 font-semibold">UNPAID</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Due summary — uses auto-calculated fine */}
        {(() => {
          const autoFine = calculateTotalFineFromEmis(emis);
          const fineDue = Math.max(breakdown?.fine_due ?? 0, autoFine);
          const emiDue = breakdown?.selected_emi_amount || breakdown?.next_emi_amount || 0;
          const firstChargeDue = breakdown?.first_emi_charge_due ?? 0;
          const totalDue = emiDue + fineDue + firstChargeDue;

          return totalDue > 0 ? (
            <div className="card p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Next Payment Due</p>
              <div className="space-y-2.5">
                {emiDue > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">EMI #{breakdown?.next_emi_no}</span>
                    <span className="font-num text-ink">{fmt(emiDue)}</span>
                  </div>
                )}
                {firstChargeDue > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gold-400">1st EMI Charge</span>
                    <span className="font-num text-gold-400">{fmt(firstChargeDue)}</span>
                  </div>
                )}
                {fineDue > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-crimson-400">Late Fine</span>
                    <span className="font-num text-crimson-400">{fmt(fineDue)}</span>
                  </div>
                )}
                <div className="h-px bg-white/[0.06]" />
                <div className="flex justify-between">
                  <span className="font-semibold text-ink">Total Payable</span>
                  <span className="font-num text-xl font-bold text-gold-400">{fmt(totalDue)}</span>
                </div>
              </div>
              {breakdown?.next_emi_due_date && (
                <p className="text-xs text-slate-500 mt-3">
                  Due: {format(new Date(breakdown.next_emi_due_date), 'd MMM yyyy')}
                </p>
              )}
              <p className="text-xs text-slate-600 mt-2">Contact your retailer or TelePoint to make a payment.</p>
            </div>
          ) : null;
        })()}

        {/* Fine Breakdown — visible to customer for transparency */}
        {(() => {
          const fineBreakdown = getPerEmiFineBreakdown(emis);
          if (fineBreakdown.length === 0) return null;
          return (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-4">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">⚠️ Fine Details</span>
              </div>
              <div className="divide-y divide-white/[0.03]">
                {fineBreakdown.map(row => (
                  <div key={row.emi_no} className="px-5 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">EMI #{row.emi_no}</span>
                      <span className="text-xs text-crimson-400 font-semibold">{row.daysOverdue} days overdue</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Base Fine</span>
                      <span className="font-num">{fmt(row.baseFineAmount)}</span>
                    </div>
                    {row.weeklyFineAmount > 0 && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Weekly Extra (₹25/week)</span>
                        <span className="font-num">{fmt(row.weeklyFineAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-crimson-400">Total Fine</span>
                      <span className="font-num text-crimson-400">{fmt(row.totalFine)}</span>
                    </div>
                    {row.finePaid > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-jade-400">Paid</span>
                        <span className="font-num text-jade-400">-{fmt(row.finePaid)}</span>
                      </div>
                    )}
                    {row.fineRemaining > 0 && row.finePaid > 0 && (
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-crimson-400">Remaining</span>
                        <span className="font-num text-crimson-400">{fmt(row.fineRemaining)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-surface-4">
                <p className="text-[11px] text-slate-600">
                  Fine rule: ₹450 base + ₹25/week. After 30 days, a new ₹450 cycle starts. Contact your retailer to pay.
                </p>
              </div>
            </div>
          );
        })()}

        {/* 1st EMI Charge status */}
        {(customer?.first_emi_charge_amount || 0) > 0 && (
          <div className={`glass-card p-4 flex items-center justify-between ${customer?.first_emi_charge_paid_at ? 'border-jade-500/20' : 'border-gold-500/20'}`}>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">1st EMI Charge</p>
              <p className="font-num font-semibold text-ink">{fmt(customer?.first_emi_charge_amount || 0)}</p>
            </div>
            {customer?.first_emi_charge_paid_at ? (
              <span className="badge-approved">✓ Paid</span>
            ) : (
              <span className="badge-pending">⚠ Pending</span>
            )}
          </div>
        )}

        <p className="text-center text-xs text-slate-700 pb-4">
          This is a read-only view. For any changes, contact TelePoint.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-600 mb-0.5 uppercase tracking-wide">{label}</p>
      <p className={`text-sm text-ink ${mono ? 'font-num' : ''}`}>{value || '—'}</p>
    </div>
  );
}
