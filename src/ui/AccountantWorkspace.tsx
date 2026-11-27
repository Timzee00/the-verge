import { useMemo, useState, type FormEvent } from 'react';
import type { Expense, Location, Sale, SaleItem } from '../core/types';
import type { SessionOrg } from '../api';
import './staff-workspace.css';

type Props = {
  userId: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizations: SessionOrg[];
  locations: Location[];
  locationId: string;
  sales: Sale[];
  saleItems: SaleItem[];
  expenses: Expense[];
  online: boolean;
  pending: number;
  onOrganizationChange: (id: string) => Promise<void>;
  onLocationChange: (id: string) => void;
  onRecordExpense: (input:{amount:string;category:string;description:string;paymentMethod:Expense['paymentMethod']}) => Promise<Expense>;
  onLogout: () => Promise<void>;
};

const money = (minor: number) => new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
}).format(Number(minor) / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export default function AccountantWorkspace(props: Props) {
  const {
    userId, userEmail, organizationId, organizationName, organizations, locations,
    locationId, sales, saleItems, expenses, online, pending, onOrganizationChange,
    onLocationChange, onRecordExpense, onLogout,
  } = props;
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Utilities');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Expense['paymentMethod']>('cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const location = locations.find(item => item.id === locationId);
  const locationSales = useMemo(() => sales.filter(sale => sale.locationId === locationId), [sales, locationId]);
  const completedSales = useMemo(() => locationSales.filter(sale => sale.status === 'completed'), [locationSales]);
  const locationSaleIds = useMemo(() => new Set(locationSales.map(sale => sale.id)), [locationSales]);
  const locationSaleItems = useMemo(() => saleItems.filter(item => locationSaleIds.has(item.saleId)), [saleItems, locationSaleIds]);
  const locationExpenses = useMemo(() => expenses.filter(item => item.locationId === locationId), [expenses, locationId]);
  const totals = useMemo(() => {
    const revenue = completedSales.reduce((sum, sale) => sum + Number(sale.totalMinor), 0);
    const cogs = locationSaleItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitCostMinor)), 0);
    const expenseTotal = locationExpenses.reduce((sum, item) => sum + Number(item.amountMinor), 0);
    return { revenue, cogs, expenseTotal, remainder: revenue - cogs - expenseTotal };
  }, [completedSales, locationSaleItems, locationExpenses]);

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await onRecordExpense({ amount, category, description, paymentMethod });
      setAmount(''); setDescription('');
      setNotice('Expense saved. It will sync automatically when the connection is available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The expense could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="staff-shell">
    <header className="staff-header">
      <div className="staff-brand">
        <span className="staff-brand-mark">V</span>
        <span><strong>THE VERGE</strong><small>Finance workspace</small></span>
      </div>
      <div className="staff-context">
        {organizations.length > 1
          ? <label><span>BUSINESS</span><select value={organizationId} onChange={event => void onOrganizationChange(event.target.value)}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          : <div className="staff-context-name"><span>BUSINESS</span><strong>{organizationName}</strong></div>}
        {locations.length > 1
          ? <label><span>ASSIGNED LOCATION</span><select value={locationId} onChange={event => onLocationChange(event.target.value)}>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          : <div className="staff-context-name"><span>ASSIGNED LOCATION</span><strong>{location?.name ?? 'No location assigned'}</strong></div>}
      </div>
      <div className="staff-header-actions">
        <span className={online ? 'staff-network is-online' : 'staff-network is-offline'}><i/>{online ? 'Online' : 'Offline'}</span>
        <button className="staff-logout" type="button" onClick={() => void onLogout()}>Sign out</button>
      </div>
    </header>

    <main className="staff-main accountant-main">
      <div className="staff-welcome">
        <div><p className="staff-kicker">FINANCE OPERATIONS</p><h1>Sales and expenses</h1><p>Review recent business activity and record branch expenses.</p></div>
        <div className="staff-operator"><span className="staff-avatar">{userEmail.slice(0, 1).toUpperCase()}</span><span><strong>{userEmail}</strong><small>Accountant · {pending} changes waiting to sync</small></span></div>
      </div>
      {!online && <div className="staff-offline-notice">Offline mode is active. New expenses are stored securely on this device and queued for sync.</div>}
      {notice && <div className="staff-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
      {error && <div className="staff-notice" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

      <div className="accountant-stats">
        <article><span>Loaded sales revenue</span><strong>{money(totals.revenue)}</strong><small>{completedSales.length} completed sales</small></article>
        <article><span>Cost of goods sold</span><strong>{money(totals.cogs)}</strong><small>From loaded sale line items</small></article>
        <article><span>Loaded expenses</span><strong>{money(totals.expenseTotal)}</strong><small>{locationExpenses.length} expense records</small></article>
        <article><span>Operating remainder</span><strong>{money(totals.remainder)}</strong><small>Revenue less COGS and loaded expenses</small></article>
      </div>

      <section className="panel accountant-expense-panel">
        <div className="section-head"><div><span className="eyebrow">EXPENSE ENTRY</span><h2>Record a business expense</h2><p>Expenses are assigned to your selected location and preserved in the business sync ledger.</p></div></div>
        <form className="accountant-expense-form" onSubmit={submitExpense}>
          <label>Amount (₦)<input required value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00"/></label>
          <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option>Utilities</option><option>Transport</option><option>Rent</option><option>Salaries</option><option>Repairs and maintenance</option><option>Supplies</option><option>Marketing</option><option>Bank charges</option><option>Other</option></select></label>
          <label>Payment method<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as Expense['paymentMethod'])}><option value="cash">Cash</option><option value="bank">Bank</option><option value="transfer">Transfer</option><option value="card">Card</option></select></label>
          <label className="accountant-description">Description<input required maxLength={240} value={description} onChange={event => setDescription(event.target.value)} placeholder="What was this expense for?"/></label>
          <button type="submit" className="staff-checkout-confirm" disabled={saving || !locationId || locationId === 'no-location'}>{saving ? 'Saving expense…' : 'Save expense'}</button>
        </form>
        {(!locationId || locationId === 'no-location') && <p className="accountant-hint">No active location is assigned. Ask the business owner to assign a location before recording expenses.</p>}
      </section>

      <section className="panel accountant-records-panel">
        <div className="accountant-records-heading"><div><span className="eyebrow">BUSINESS LEDGER</span><h2>Recent expenses</h2></div><span>{locationExpenses.length} loaded</span></div>
        {locationExpenses.length
          ? <div className="accountant-record-list">{locationExpenses.map(item => <article key={item.id}>
              <div><strong>{item.category}</strong><small>{item.description} · {item.locationId ? locations.find(loc => loc.id === item.locationId)?.name ?? 'Assigned location' : 'Business-wide'}</small><small>{dateTime(item.occurredAt)} · {item.paymentMethod}</small></div>
              <div className="accountant-record-amount"><strong>{money(item.amountMinor)}</strong><span className={item.syncState === 'synced' ? 'staff-sync-pill is-synced' : 'staff-sync-pill'}>{item.syncState === 'synced' ? 'Synced' : item.syncState === 'rejected' ? 'Rejected' : 'Pending sync'}</span></div>
            </article>)}</div>
          : <div className="staff-empty">No business expenses are available for your assigned locations yet.</div>}
      </section>

      <section className="panel accountant-records-panel">
        <div className="accountant-records-heading"><div><span className="eyebrow">SALES ACTIVITY</span><h2>Recent sales</h2></div><span>{completedSales.length} loaded</span></div>
        {completedSales.length
          ? <div className="accountant-record-list">{completedSales.slice(0, 30).map(sale => <article key={sale.id}>
              <div><strong>{money(sale.totalMinor)}</strong><small>{dateTime(sale.occurredAt)} · {sale.paymentMethod}</small><small>{locations.find(loc => loc.id === sale.locationId)?.name ?? 'Assigned location'}</small></div>
              <span className={sale.syncState === 'synced' ? 'staff-sync-pill is-synced' : 'staff-sync-pill'}>{sale.syncState === 'synced' ? 'Synced' : 'Pending sync'}</span>
            </article>)}</div>
          : <div className="staff-empty">No completed sales are available for your assigned locations yet.</div>}
      </section>

      <p className="accountant-disclaimer">This workspace summarizes the most recent records cached on this device (up to 50 sales and 100 expenses). It is an operational snapshot, not a period-close statement or a substitute for posted double-entry accounts.</p>
      <footer className="staff-footer"><span>THE VERGE · Powered by Timzee Corp</span><span>{location?.name ?? 'No location'} · {online ? 'Connected' : 'Offline'} · Staff {userId.slice(0, 6).toUpperCase()}</span></footer>
    </main>
  </div>;
}
