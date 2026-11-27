import { useEffect, useMemo, useState } from 'react';
import type { InventoryEvent, Location, Product } from '../core/types';
import { localDB } from '../db/local';
import { getLocalStock } from '../inventory/ledger';
import { validateInventoryEvent } from '../domain/inventory';
import InventoryTools from '../inventory/InventoryTools';
import type { SessionOrg } from '../api';
import './staff-workspace.css';

type Props = {
  userId: string;
  userEmail: string;
  deviceId: string;
  organizationId: string;
  organizationName: string;
  organizations: SessionOrg[];
  locations: Location[];
  locationId: string;
  products: Product[];
  online: boolean;
  pending: number;
  onOrganizationChange: (id: string) => Promise<void>;
  onLocationChange: (id: string) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
};

const money = (minor: number) => new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
}).format(minor / 100);

const uid = () => crypto.randomUUID();

export default function InventoryStaffWorkspace(props: Props) {
  const {
    userId, userEmail, deviceId, organizationId, organizationName, organizations,
    locations, locationId, products, online, pending, onOrganizationChange,
    onLocationChange, onRefresh, onLogout,
  } = props;
  const [query, setQuery] = useState('');
  const [stock, setStock] = useState<Record<string, number>>({});
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const location = locations.find(item => item.id === locationId);
  const activeProducts = useMemo(() => products.filter(product => product.active), [products]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return activeProducts.filter(product => !normalized || [
      product.name, product.sku, product.barcode, product.brand, product.category,
    ].some(value => String(value ?? '').toLocaleLowerCase().includes(normalized)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100);
  }, [activeProducts, query]);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const entries = await Promise.all(filtered.map(async product =>
        [product.id, await getLocalStock(locationId, product.id)] as const));
      if (current) setStock(previous => ({ ...previous, ...Object.fromEntries(entries) }));
    };
    if (locationId && locationId !== 'no-location') void load().catch(() => {
      if (current) setError('Stock figures could not be refreshed. Check your connection and try again.');
    });
    else setStock({});
    return () => { current = false; };
  }, [filtered, locationId, products]);

  const lowStockCount = activeProducts.filter(product =>
    product.reorderLevel !== undefined &&
    stock[product.id] !== undefined &&
    stock[product.id] <= product.reorderLevel,
  ).length;

  async function receiveStock() {
    const product = activeProducts.find(item => item.id === selectedProductId);
    const count = Number(quantity);
    if (!product) { setError('Choose an active product first.'); return; }
    if (!locationId || locationId === 'no-location') { setError('This account has no active assigned location. Contact the owner.'); return; }
    if (!Number.isSafeInteger(count) || count <= 0) { setError('Quantity must be a positive whole number.'); return; }
    if (saving) return;

    setSaving(true); setError(''); setNotice('');
    try {
      const createdAt = new Date().toISOString();
      await localDB.transaction('rw', [
        localDB.inventoryEvents, localDB.syncOperations, localDB.meta,
      ], async () => {
        const current = Number((await localDB.meta.get('localSequence'))?.value ?? Date.now());
        const localSequence = Math.max(current, Date.now()) + 1;
        const event: InventoryEvent = {
          id: uid(), organizationId, locationId, productId: product.id,
          type: 'purchase', quantityDelta: count, unitCostMinor: product.standardCostMinor,
          occurredAt: createdAt, deviceId, localSequence, syncState: 'pending', createdAt,
        };
        validateInventoryEvent(event);
        const operation = {
          id: uid(), organizationId, deviceId, entity: 'inventory_event' as const,
          entityId: event.id, operation: 'create' as const, payload: event,
          createdAt, attempts: 0, state: 'pending' as const, localSequence,
        };
        await localDB.inventoryEvents.add(event);
        await localDB.syncOperations.add(operation);
        await localDB.meta.put({ key: 'localSequence', value: String(localSequence) });
      });
      setQuantity('1');
      setNotice(`Received ${count} ${product.unit} of ${product.name}. The stock record is saved and queued for sync.`);
      await onRefresh();
      setStock(previous => ({ ...previous, [product.id]: (previous[product.id] ?? 0) + count }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The stock receipt could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="staff-shell">
    <header className="staff-header">
      <div className="staff-brand">
        <span className="staff-brand-mark">V</span>
        <span><strong>THE VERGE</strong><small>Inventory workspace</small></span>
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

    <main className="staff-main inventory-staff-main">
      <div className="staff-welcome">
        <div><p className="staff-kicker">INVENTORY OPERATIONS</p><h1>Stock and products</h1><p>Check stock at your assigned location, receive deliveries and maintain the product catalogue.</p></div>
        <div className="staff-operator"><span className="staff-avatar">{userEmail.slice(0, 1).toUpperCase()}</span><span><strong>{userEmail}</strong><small>Inventory staff · {pending} changes waiting to sync</small></span></div>
      </div>
      {!online && <div className="staff-offline-notice">Offline mode is active. Receipts are saved on this device and will sync when the connection returns.</div>}
      {notice && <div className="staff-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
      {error && <div className="staff-notice" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

      <div className="inventory-staff-stats">
        <article><span>Active products</span><strong>{activeProducts.length}</strong></article>
        <article><span>Low-stock items</span><strong>{lowStockCount}</strong></article>
        <article><span>Assigned locations</span><strong>{locations.length}</strong></article>
        <article><span>Pending sync</span><strong>{pending}</strong></article>
      </div>

      <section className="staff-catalogue inventory-staff-catalogue">
        <div className="staff-transactions-heading inventory-staff-heading">
          <div><p className="staff-kicker">LOCATION STOCK</p><h2>{location?.name ?? 'Assigned location'}</h2></div>
          <button className="staff-scan-btn" type="button" onClick={() => void onRefresh()}>Refresh stock</button>
        </div>
        <label className="staff-search inventory-staff-search">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search products" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by product, SKU or barcode…"/>
        </label>
        <div className="inventory-staff-table-wrap">
          <table className="staff-admin-table inventory-staff-table">
            <thead><tr><th>Product</th><th>SKU / Barcode</th><th>Unit cost</th><th>Available stock</th><th>Reorder level</th></tr></thead>
            <tbody>{filtered.map(product => {
              const amount = stock[product.id];
              const low = amount !== undefined && product.reorderLevel !== undefined && amount <= product.reorderLevel;
              return <tr key={product.id}>
                <td><strong>{product.name}</strong><small>{product.category ?? 'General'}</small></td>
                <td><span>{product.sku}</span><small>{product.barcode ?? 'No barcode'}</small></td>
                <td>{money(product.standardCostMinor)}</td>
                <td><strong className={low ? 'inventory-staff-low' : ''}>{amount === undefined ? '—' : amount.toLocaleString('en-NG')}</strong></td>
                <td>{product.reorderLevel ?? '—'}</td>
              </tr>;
            })}</tbody>
          </table>
          {!filtered.length && <div className="staff-empty">No products match this search.</div>}
          {filtered.length === 100 && <p className="staff-list-limit">Showing the first 100 matches. Refine your search to narrow the list.</p>}
        </div>
      </section>

      <section className="panel inventory-staff-receive">
        <div className="section-head"><div><span className="eyebrow">GOODS RECEIVING</span><h2>Receive stock</h2><p>Record a supplier delivery or stock receipt for the selected location. Each receipt becomes an auditable inventory event.</p></div></div>
        <div className="inventory-staff-receive-form">
          <label>Product<select value={selectedProductId} onChange={event => setSelectedProductId(event.target.value)}><option value="">Choose product</option>{activeProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          <label>Quantity received<input type="number" min="1" step="1" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
          <button type="button" className="staff-checkout-confirm" disabled={saving || !selectedProductId || !locationId || locationId === 'no-location'} onClick={() => void receiveStock()}>{saving ? 'Saving receipt…' : 'Record stock receipt'}</button>
        </div>
      </section>

      {locationId !== 'no-location' && <InventoryTools
        products={products}
        organizationId={organizationId}
        locationId={locationId}
        deviceId={deviceId}
        onBarcode={setQuery}
        onImported={onRefresh}
        notify={setNotice}
      />}
      {locationId === 'no-location' && <section className="panel inventory-staff-receive"><strong>No location is assigned</strong><p>Ask the business owner to assign at least one active location before importing or receiving stock.</p></section>}
      <footer className="staff-footer"><span>THE VERGE · Powered by Timzee Corp</span><span>{location?.name ?? 'No location'} · {online ? 'Connected' : 'Offline'} · Staff {userId.slice(0, 6).toUpperCase()}</span></footer>
    </main>
  </div>;
}
