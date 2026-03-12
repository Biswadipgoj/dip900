'use client';

import { useState, useEffect } from 'react';
import { Customer, EMISchedule, DueBreakdown } from '@/lib/types';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { calculateTotalFineFromEmis } from '@/lib/fineCalc';
import FineSummaryPanel from './FineSummaryPanel';

interface PaymentModalProps {
  customer: Customer;
  emis: EMISchedule[];
  breakdown: DueBreakdown | null;
  onClose: () => void;
  onSubmitted: () => void;
  isAdmin?: boolean;
}

const UPI_ID = 'biswajit.khanra82@axl';
const UPI_NAME = 'TelePoint';

// Collect types — default is emi_full_due (EMI + Fine + 1st Charge)
type CollectType = 'emi_full_due' | 'emi_only' | 'fine_only' | 'first_charge_only' | 'emi_fine' | 'emi_first_charge';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function PaymentModal({ customer, emis, breakdown, onClose, onSubmitted, isAdmin }: PaymentModalProps) {
  const unpaidEmis = emis.filter(e => e.status === 'UNPAID');
  const defaultEmiNo = breakdown?.next_emi_no ?? unpaidEmis[0]?.emi_no ?? 0;

  const [selectedEmiNo, setSelectedEmiNo] = useState<number>(defaultEmiNo);
  const [mode, setMode] = useState<'CASH' | 'UPI'>('CASH');
  const [utr, setUtr] = useState('');
  // Default collect type: full due (EMI + Fine + 1st Charge)
  const [collectType, setCollectType] = useState<CollectType>('emi_full_due');
  const [retailerPin, setRetailerPin] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptId, setReceiptId] = useState('');
  const [showFineSummary, setShowFineSummary] = useState(false);

  // Editable amount overrides — stored INDEPENDENTLY from collect type
  // so they survive toggling
  const [editedEmiPaid, setEditedEmiPaid] = useState<string>('');
  const [editedFinePaid, setEditedFinePaid] = useState<string>('');
  const [editedFirstEmiChargePaid, setEditedFirstEmiChargePaid] = useState<string>('');

  // Selected EMI
  const selectedEmi = unpaidEmis.find(e => e.emi_no === selectedEmiNo) || emis.find(e => e.emi_no === selectedEmiNo);
  const scheduledEmiAmount = selectedEmi?.amount ?? 0;

  // ── FINE: always auto-calculated from EMI rows ────────────────────────
  // Takes the MAX of: DB-stored value (from RPC) vs client-calculated value
  const autoCalculatedFine = calculateTotalFineFromEmis(emis);
  const scheduledFine = Math.max(breakdown?.fine_due ?? 0, autoCalculatedFine);

  const scheduledFirstEmiCharge = breakdown?.first_emi_charge_due
    ?? (customer.first_emi_charge_paid_at ? 0 : (customer.first_emi_charge_amount || 0));

  // ── Determine what's included based on collect type ───────────────────
  const includeEmi = collectType !== 'fine_only' && collectType !== 'first_charge_only';
  const includeFine = collectType !== 'emi_only' && collectType !== 'first_charge_only' && collectType !== 'emi_first_charge';
  const includeFirstCharge = collectType === 'emi_full_due' || collectType === 'first_charge_only' || collectType === 'emi_first_charge';

  // ── Amounts: use edited value if set, else scheduled ──────────────────
  const emiAmount = includeEmi ? (editedEmiPaid !== '' ? Math.max(0, parseFloat(editedEmiPaid) || 0) : scheduledEmiAmount) : 0;
  const fineAmount = includeFine ? (editedFinePaid !== '' ? Math.max(0, parseFloat(editedFinePaid) || 0) : scheduledFine) : 0;
  const firstEmiCharge = includeFirstCharge ? (editedFirstEmiChargePaid !== '' ? Math.max(0, parseFloat(editedFirstEmiChargePaid) || 0) : scheduledFirstEmiCharge) : 0;
  const totalPayable = emiAmount + fineAmount + firstEmiCharge;

  // Auto-select first unpaid EMI
  useEffect(() => {
    if (selectedEmiNo === 0 && unpaidEmis.length > 0) {
      setSelectedEmiNo(unpaidEmis[0].emi_no);
    }
  }, [selectedEmiNo, unpaidEmis]);

  // Reset edited amounts ONLY when EMI selection changes (not on collect type change!)
  useEffect(() => {
    setEditedEmiPaid('');
    setEditedFinePaid('');
    setEditedFirstEmiChargePaid('');
  }, [selectedEmiNo]);

  // QR Code
  useEffect(() => {
    if (mode === 'UPI' && totalPayable > 0) {
      import('qrcode').then(QRCode => {
        const tn = `EMI${selectedEmiNo}_${customer.imei.slice(-6)}`;
        const upiStr = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${totalPayable}&tn=${tn}&cu=INR`;
        QRCode.toDataURL(upiStr, { width: 240, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } })
          .then(setQrDataUrl);
      }).catch(() => {});
    } else {
      setQrDataUrl('');
    }
  }, [mode, totalPayable, selectedEmiNo, customer.imei]);

  async function handleSubmit() {
    if (includeEmi && !selectedEmi && collectType !== 'fine_only' && collectType !== 'first_charge_only') {
      toast.error('Please select an EMI to pay');
      return;
    }
    if (!isAdmin && !retailerPin.trim()) {
      toast.error('Enter your Retail PIN');
      return;
    }
    if (mode === 'UPI' && !utr.trim()) {
      toast.error('UTR / Reference number required for UPI');
      return;
    }
    if (totalPayable <= 0) {
      toast.error('Total payable must be greater than 0');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isAdmin ? '/api/payments/approve-direct' : '/api/payments/submit';
      const payload = {
        customer_id: customer.id,
        emi_ids: includeEmi && selectedEmi ? [selectedEmi.id] : [],
        emi_nos: includeEmi && selectedEmi ? [selectedEmi.emi_no] : [],
        mode,
        utr: mode === 'UPI' ? utr.trim() : null,
        notes: notes || null,
        retail_pin: isAdmin ? undefined : retailerPin,
        total_emi_amount: emiAmount,
        scheduled_emi_amount: scheduledEmiAmount,
        fine_amount: fineAmount,
        first_emi_charge_amount: firstEmiCharge,
        total_amount: totalPayable,
        fine_for_emi_no: fineAmount > 0 ? selectedEmiNo : undefined,
        fine_due_date: fineAmount > 0 && selectedEmi ? selectedEmi.due_date : undefined,
        collected_by_role: isAdmin ? 'admin' : 'retailer',
        collect_type: collectType,
      };

      console.log('Payment payload:', payload);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data;
      try { data = await res.json(); } catch { toast.error('Server error'); return; }

      if (!res.ok) {
        toast.error(data.error || `Payment failed (${res.status})`);
      } else {
        toast.success(isAdmin ? '✅ Payment recorded & approved!' : '📋 Payment request submitted — pending approval');
        if (data.request_id) {
          setReceiptId(data.request_id);
          setShowReceipt(true);
        } else {
          onSubmitted();
          onClose();
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Payment failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Receipt Screen ────────────────────────────────────────────────────
  if (showReceipt && receiptId) {
    const now = new Date();
    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { onSubmitted(); onClose(); } }}>
        <div className="modal-panel max-w-sm mx-auto animate-scale-in">
          <div className="bg-brand-500 px-6 py-5 text-center">
            <div className="text-4xl mb-2">{isAdmin ? '✅' : '📋'}</div>
            <h2 className="text-ink font-bold text-xl font-display">{isAdmin ? 'Payment Approved' : 'Request Submitted'}</h2>
            <p className="text-brand-200 text-sm mt-1">{isAdmin ? 'Payment recorded successfully' : 'Awaiting admin approval'}</p>
          </div>
          <div className="p-6 space-y-3">
            <div className="card bg-surface-2 p-4 space-y-2.5">
              <Row label="Customer" value={customer.customer_name} bold />
              <Row label="IMEI" value={customer.imei} mono />
              <Row label="Mobile" value={customer.mobile} mono />
              {customer.model_no && <Row label="Model" value={customer.model_no} />}
              <div className="divider !my-2" />
              {emiAmount > 0 && <Row label={`EMI #${selectedEmiNo}`} value={fmt(emiAmount)} bold />}
              {firstEmiCharge > 0 && <Row label="1st EMI Charge" value={fmt(firstEmiCharge)} />}
              {fineAmount > 0 && <Row label="Late Fine" value={fmt(fineAmount)} danger />}
              <div className="divider !my-2" />
              <div className="flex justify-between items-center">
                <span className="font-bold text-ink text-base">Total Paid</span>
                <span className="font-mono font-bold text-xl text-brand-600">{fmt(totalPayable)}</span>
              </div>
              <Row label="Mode" value={mode} />
              <Row label="Date & Time" value={format(now, 'd MMM yyyy, h:mm a')} mono />
              <Row label="Ref #" value={receiptId.slice(0, 8).toUpperCase()} mono />
            </div>
            <button onClick={() => {
              const msg = [`🧾 *TelePoint EMI Receipt*`, '', `👤 ${customer.customer_name}`, `📱 ${customer.mobile}`, `📦 ${customer.model_no || 'Device'}`, `🔢 IMEI: ${customer.imei}`, '',
                ...(emiAmount > 0 ? [`💳 EMI #${selectedEmiNo}: ${fmt(emiAmount)}`] : []),
                ...(firstEmiCharge > 0 ? [`⭐ 1st EMI Charge: ${fmt(firstEmiCharge)}`] : []),
                ...(fineAmount > 0 ? [`⚠️ Fine: ${fmt(fineAmount)}`] : []),
                `💰 *Total Paid: ${fmt(totalPayable)}*`, `🏷️ Mode: ${mode}`, `📅 ${format(now, 'd MMM yyyy, h:mm a')}`,
                ...(isAdmin ? [] : [`⏳ Status: Pending Approval`]), '', `— TelePoint EMI Portal`].join('\n');
              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
            }} className="btn w-full py-3 bg-green-500 hover:bg-green-600 text-white">Share on WhatsApp</button>
            <button onClick={() => window.open(`/receipt/${receiptId}`, '_blank')} className="btn-secondary w-full py-2.5">🧾 View / Print Receipt</button>
            <button onClick={() => { onSubmitted(); onClose(); }} className="btn-ghost w-full py-2.5">Close</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Fine Summary Panel ────────────────────────────────────────────────
  if (showFineSummary) {
    return <FineSummaryPanel emis={emis} onClose={() => setShowFineSummary(false)} />;
  }

  // ── Main Payment Modal ────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-surface-4 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-ink text-lg">{isAdmin ? 'Record Payment' : 'Submit Payment'}</h2>
            <p className="text-ink-muted text-xs mt-0.5">{customer.customer_name} · {customer.imei}</p>
          </div>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* ── DUE SUMMARY CARD ── Always visible, shows what's due */}
          <div className="card bg-surface-2 p-4 space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">Amount Due</p>
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">EMI #{selectedEmiNo || '—'}</span>
              <span className="num font-medium text-ink">{fmt(scheduledEmiAmount)}</span>
            </div>
            {scheduledFine > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-danger">Late Fine</span>
                <span className="num font-semibold text-danger">{fmt(scheduledFine)}</span>
              </div>
            )}
            {scheduledFirstEmiCharge > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-warning">1st EMI Charge</span>
                <span className="num font-medium text-warning">{fmt(scheduledFirstEmiCharge)}</span>
              </div>
            )}
            <div className="h-px bg-surface-4" />
            <div className="flex justify-between items-center">
              <span className="font-bold text-ink">Total Due</span>
              <span className="num text-xl font-bold text-brand-600">{fmt(scheduledEmiAmount + scheduledFine + scheduledFirstEmiCharge)}</span>
            </div>
          </div>

          {/* ── FINE SUMMARY BUTTON ── */}
          {scheduledFine > 0 && (
            <button
              type="button"
              onClick={() => setShowFineSummary(true)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-danger-border bg-danger-light text-left transition-all hover:border-danger"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-danger">Late Fine: {fmt(scheduledFine)}</p>
                  <p className="text-xs text-danger/70">₹450 base + ₹25/week + monthly reset</p>
                </div>
              </div>
              <span className="text-xs text-danger font-medium">View Details →</span>
            </button>
          )}

          {/* ── COLLECT TYPE ── Default = Full Due */}
          <div>
            <label className="label">What to collect?</label>
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'emi_full_due' as CollectType, label: '💳 Full Due', desc: 'EMI + Fine + Charge' },
                { key: 'emi_only' as CollectType, label: '📋 EMI Only', desc: '' },
                { key: 'fine_only' as CollectType, label: '⚠️ Fine Only', desc: '' },
                { key: 'emi_fine' as CollectType, label: '💳 EMI + Fine', desc: '' },
              ]).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setCollectType(t.key)}
                  className={`flex-1 min-w-[100px] py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                    collectType === t.key
                      ? 'border-brand-400 bg-brand-50 text-brand-700'
                      : 'border-surface-4 text-ink-muted hover:border-surface-3'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── EMI SELECTOR ── */}
          {includeEmi && (
            <div>
              <label className="label">Select EMI to Pay *</label>
              {unpaidEmis.length === 0 ? (
                <div className="alert-success text-center py-4">
                  <p className="text-success font-semibold">✓ All EMIs are paid or pending</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unpaidEmis.map(emi => {
                    const isNext = emi.emi_no === (breakdown?.next_emi_no ?? unpaidEmis[0]?.emi_no);
                    const isOverdue = new Date(emi.due_date) < new Date();
                    const sel = selectedEmiNo === emi.emi_no;
                    return (
                      <button key={emi.id} type="button" onClick={() => setSelectedEmiNo(emi.emi_no)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${sel ? 'border-brand-400 bg-brand-50' : 'border-surface-4 hover:border-brand-300 hover:bg-surface-2'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'bg-brand-500 border-brand-500' : 'border-surface-4'}`}>
                            {sel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><path d="M20 6L9 17l-5-5"/></svg>}
                          </div>
                          <div>
                            <span className={`text-sm font-semibold ${sel ? 'text-brand-700' : 'text-ink'}`}>EMI #{emi.emi_no}</span>
                            {isNext && <span className="ml-2 text-[10px] bg-success-light text-success border border-success-border px-1.5 py-0.5 rounded-full font-bold">NEXT DUE</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="num text-sm font-semibold text-ink">{fmt(emi.amount)}</p>
                          <p className={`text-xs ${isOverdue ? 'text-danger font-medium' : 'text-ink-muted'}`}>
                            {format(new Date(emi.due_date), 'd MMM yyyy')}{isOverdue && ' ⚠'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── PAYMENT MODE ── */}
          <div>
            <label className="label">Payment Mode</label>
            <div className="flex gap-2">
              {(['CASH', 'UPI'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${mode === m ? (m === 'CASH' ? 'border-success bg-success-light text-success' : 'border-info bg-info-light text-info') : 'border-surface-4 text-ink-muted'}`}>
                  {m === 'CASH' ? '💵 Cash' : '📱 UPI'}
                </button>
              ))}
            </div>
          </div>

          {/* UTR */}
          {mode === 'UPI' && (
            <div>
              <label className="label">UTR / Reference <span className="text-danger">*</span></label>
              <input type="text" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Enter UTR number" className={`input ${!utr.trim() ? 'border-warning' : ''}`} autoComplete="off" />
            </div>
          )}

          {/* QR */}
          {mode === 'UPI' && qrDataUrl && (
            <div className="card bg-surface-2 p-4 flex flex-col items-center gap-3">
              <div className="bg-white p-3 rounded-xl shadow-sm border border-surface-4"><img src={qrDataUrl} alt="UPI QR" className="w-48 h-48" /></div>
              <p className="num font-bold text-xl text-ink">{fmt(totalPayable)}</p>
              <p className="text-xs text-ink-muted">UPI: <span className="num font-semibold text-ink">{UPI_ID}</span></p>
              <button onClick={() => navigator.clipboard.writeText(UPI_ID).then(() => toast.success('Copied!'))} className="btn-secondary text-xs px-3 py-1.5">Copy UPI ID</button>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any notes…" className="input resize-none" />
          </div>

          {/* Retail PIN */}
          {!isAdmin && (
            <div>
              <label className="label">Retail PIN <span className="text-danger">*</span></label>
              <input type="password" value={retailerPin} onChange={e => setRetailerPin(e.target.value)} placeholder="4–6 digit PIN" inputMode="numeric" className="input" autoComplete="off" />
            </div>
          )}

          {/* ── EDITABLE AMOUNTS ── */}
          <div className="card bg-surface-2 p-4 space-y-3">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">Collected Amounts <span className="font-normal normal-case text-brand-500">(editable)</span></p>
            {includeEmi && scheduledEmiAmount > 0 && (
              <div>
                <label className="label text-xs">EMI #{selectedEmiNo} (₹) <span className="text-ink-muted">scheduled: {fmt(scheduledEmiAmount)}</span></label>
                <input type="number" min={0} value={editedEmiPaid} onChange={e => setEditedEmiPaid(e.target.value)} placeholder={String(scheduledEmiAmount)} className="input" inputMode="numeric" />
              </div>
            )}
            {includeFine && scheduledFine > 0 && (
              <div>
                <label className="label text-xs">Fine (₹) <span className="text-ink-muted">due: {fmt(scheduledFine)}</span></label>
                <input type="number" min={0} value={editedFinePaid} onChange={e => setEditedFinePaid(e.target.value)} placeholder={String(scheduledFine)} className="input" inputMode="numeric" />
              </div>
            )}
            {includeFirstCharge && scheduledFirstEmiCharge > 0 && (
              <div>
                <label className="label text-xs">1st EMI Charge (₹) <span className="text-ink-muted">due: {fmt(scheduledFirstEmiCharge)}</span></label>
                <input type="number" min={0} value={editedFirstEmiChargePaid} onChange={e => setEditedFirstEmiChargePaid(e.target.value)} placeholder={String(scheduledFirstEmiCharge)} className="input" inputMode="numeric" />
              </div>
            )}
          </div>

          {/* ── PAYMENT SUMMARY ── */}
          <div className="card bg-surface-2 p-4 space-y-2.5">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3">Payment Summary</p>
            {emiAmount > 0 && <div className="flex justify-between text-sm"><span className="text-ink-muted">EMI #{selectedEmiNo}</span><span className="num font-medium text-ink">{fmt(emiAmount)}</span></div>}
            {firstEmiCharge > 0 && <div className="flex justify-between text-sm"><span className="text-warning">1st EMI Charge</span><span className="num font-medium text-warning">{fmt(firstEmiCharge)}</span></div>}
            {fineAmount > 0 && <div className="flex justify-between text-sm"><span className="text-danger">Late Fine</span><span className="num font-medium text-danger">{fmt(fineAmount)}</span></div>}
            <div className="h-px bg-surface-4" />
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink">Total Payable</span>
              <span className="num text-2xl font-bold text-brand-600">{fmt(totalPayable)}</span>
            </div>
            <p className="text-[11px] text-ink-muted">{isAdmin ? '→ Will be instantly approved' : '→ Sent to admin for approval'}</p>
          </div>

          {/* ── ACTIONS ── */}
          <div className="flex gap-3 pb-1">
            <button onClick={onClose} className="btn-secondary flex-1 py-3">Cancel</button>
            <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1 py-3">
              {loading ? 'Processing…' : isAdmin ? '✓ Record Payment' : '→ Submit Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, mono, danger }: { label: string; value: string; bold?: boolean; mono?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${mono ? 'num' : ''} ${danger ? 'text-danger' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
