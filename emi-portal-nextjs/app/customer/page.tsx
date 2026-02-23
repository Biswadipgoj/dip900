'use client';

import { useState } from 'react';
import { Customer, EMISchedule, DueBreakdown } from '@/lib/types';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function CustomerPortal() {
  const [aadhaar, setAadhaar] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [emis, setEmis] = useState<EMISchedule[]>([]);
  const [breakdown, setBreakdown] = useState<DueBreakdown | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (aadhaar.length !== 12) { toast.error('Aadhaar must be 12 digits'); return; }
    if (mobile.length !== 10) { toast.error('Mobile must be 10 digits'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aadhaar, mobile }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      setCustomer(data.customer);
      setEmis(data.emis);
      setBreakdown(data.breakdown);
      setLoggedIn(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setLoggedIn(false);
    setCustomer(null);
    setEmis([]);
    setBreakdown(null);
    setAadhaar('');
    setMobile('');
  }

  const paidEmis = emis.filter(e => e.status === 'APPROVED');
  const unpaidEmis = emis.filter(e => e.status === 'UNPAID');

  if (!loggedIn) {
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
              Login using your Aadhaar and registered mobile number
            </p>
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="form-label">Aadhaar Number</label>
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
                <label className="form-label">Mobile Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  className="form-input"
                />
              </div>
              <button type="submit" disabled={loading || aadhaar.length !== 12 || mobile.length !== 10} className="btn-primary w-full py-3.5 text-base mt-2">
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
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-crimson-400 transition-colors border border-white/[0.08] px-3 py-1.5 rounded-lg">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

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
                <span className="badge-running">● Running</span>
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

          {/* Progress */}
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

          {/* EMI list */}
          <div className="divide-y divide-white/[0.03]">
            {emis.map(emi => {
              const isOverdue = emi.status === 'UNPAID' && new Date(emi.due_date) < new Date();
              return (
                <div key={emi.id} className={`flex items-center justify-between px-5 py-3.5 ${isOverdue ? 'bg-crimson-500/5' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      emi.status === 'APPROVED' ? 'bg-jade-500/20 text-jade-400' :
                      emi.status === 'PENDING_APPROVAL' ? 'bg-gold-500/20 text-gold-400' :
                      isOverdue ? 'bg-crimson-500/20 text-crimson-400' : 'bg-surface-3 text-slate-500'
                    }`}>
                      {emi.emi_no}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${emi.status === 'APPROVED' ? 'text-jade-400' : isOverdue ? 'text-crimson-300' : 'text-ink'}`}>
                        EMI #{emi.emi_no}
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

        {/* Due summary */}
        {breakdown && breakdown.total_payable > 0 && (
          <div className="card p-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Next Payment Due</p>
            <div className="space-y-2.5">
              {(breakdown.selected_emi_amount || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">EMI #{breakdown.next_emi_no}</span>
                  <span className="font-num text-ink">{fmt(breakdown.selected_emi_amount || breakdown.next_emi_amount || 0)}</span>
                </div>
              )}
              {breakdown.first_emi_charge_due > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gold-400">1st EMI Charge</span>
                  <span className="font-num text-gold-400">{fmt(breakdown.first_emi_charge_due)}</span>
                </div>
              )}
              {breakdown.fine_due > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-crimson-400">Late Fine</span>
                  <span className="font-num text-crimson-400">{fmt(breakdown.fine_due)}</span>
                </div>
              )}
              <div className="h-px bg-white/[0.06]" />
              <div className="flex justify-between">
                <span className="font-semibold text-ink">Total Payable</span>
                <span className="font-num text-xl font-bold text-gold-400">{fmt(breakdown.total_payable)}</span>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-4">Contact your retailer or TelePoint to make a payment.</p>
          </div>
        )}

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
