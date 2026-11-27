import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Customer, Expense, Location, ParkedCart, Product, Sale, SaleItem } from '../core/types';
import type { SessionOrg } from '../api';
import { localDB } from '../db/local';
import { getLocalStock } from '../inventory/ledger';
import { calculateCartTotals } from '../domain/pos';
import './staff-workspace.css';
import InventoryStaffWorkspace from './InventoryStaffWorkspace';
import AccountantWorkspace from './AccountantWorkspace';

const BarcodeScanner = lazy(() => import('../inventory/BarcodeScanner'));
type PaymentMethod = Sale['paymentMethod'];
type CartLine = { productId: string; quantity: number };
type CheckoutRequest = { items: CartLine[]; customerId?: string; paymentMethod: PaymentMethod };
type Receipt = { sale: Sale; lines: Array<{ product: Product; quantity: number; unitPriceMinor: number }> };

type Props = {
  role: string;
  deviceId: string;
  onRefresh: () => Promise<void>;
  expenses: Expense[];
  onRecordExpense: (input:{amount:string;category:string;description:string;paymentMethod:Expense['paymentMethod']}) => Promise<Expense>;
  userId: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizations: SessionOrg[];
  locations: Location[];
  locationId: string;
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  saleItems: SaleItem[];
  online: boolean;
  pending: number;
  onOrganizationChange: (id: string) => Promise<void>;
  onLocationChange: (id: string) => void;
  onCheckout: (request: CheckoutRequest) => Promise<Sale>;
  onLogout: () => Promise<void>;
};

const money = (minor: number) => new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
}).format(minor / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));
const uid = () => crypto.randomUUID();

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.2 4.2"/></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16M8 9v6m4-6v6m4-6v6"/></>,
    box: <><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z"/><path d="m3.5 7.5 8.5 4 8.5-4M12 12v9M8 5l9 4.5"/></>,
    cart: <><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 1.9-1.5L20 8H6"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <path d="M5 12h14"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M8 8h8M8 12h8M8 16h4"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    wifi: <><path d="M5 9a11 11 0 0 1 14 0M8 12a7 7 0 0 1 8 0M11 15a2.5 2.5 0 0 1 2 0M12 19h.01"/></>,
    printer: <><path d="M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0 1 4M20 5v6h-6"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.box}</svg>;
}

export default function StaffWorkspace(props: Props) {
  if (props.role === 'inventory_staff') return <InventoryStaffWorkspace {...props}/>;
  if (props.role === 'accountant') return <AccountantWorkspace {...props}/>;
  if (props.role !== 'cashier') {
    return <div className="staff-shell">
      <header className="staff-header"><div className="staff-brand"><span className="staff-brand-mark">V</span><span><strong>THE VERGE</strong><small>Staff workspace</small></span></div><button className="staff-logout" onClick={() => void props.onLogout()}><Icon name="logout"/> Sign out</button></header>
      <main className="staff-restricted">
        <div className="staff-restricted-icon"><Icon name="box" size={30}/></div>
        <p className="staff-kicker">ROLE-RESTRICTED WORKSPACE</p>
        <h1>Your access is limited to your assigned role.</h1>
        <p>The current staff console is enabled for cashier accounts. Ask the business owner to assign the correct role or enable the corresponding staff workspace.</p>
        <span className="staff-role-label">{props.role.replaceAll('_', ' ')}</span>
      </main>
    </div>;
  }

  return <CashierWorkspace {...props}/>;
}

function CashierWorkspace({
  userId, userEmail, organizationId, organizationName, organizations, locations, locationId, products, customers, sales, saleItems, online, pending,
  onOrganizationChange, onLocationChange, onCheckout, onLogout,
}: Props) {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<Record<string, number>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [parkedCarts, setParkedCarts] = useState<ParkedCart[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const activeProducts = useMemo(() => products.filter(product => product.active), [products]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const resultProducts = useMemo(() => activeProducts.filter(product => !normalizedQuery || [
    product.name, product.sku, product.barcode, product.brand, product.category,
  ].some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 48), [activeProducts, normalizedQuery]);

  useEffect(() => {
    let current = true;
    const ids = new Set([...resultProducts.map(product => product.id), ...cart.map(line => line.productId)]);
    void Promise.all([...ids].map(async id => [id, await getLocalStock(locationId, id)] as const))
      .then(values => {
        if (current) setStock(previous => ({ ...previous, ...Object.fromEntries(values) }));
      })
      .catch(() => { if (current) setNotice('Could not refresh stock figures. Refresh the workspace before checkout.'); });
    return () => { current = false; };
  }, [resultProducts, cart, locationId]);

  useEffect(() => {
    setNotice(''); setQuery(''); setSelectedCustomerId(''); setStock({});
  }, [organizationId, locationId]);

  useEffect(() => {
    let current = true;
    if (!organizationId || !locationId || locationId === 'no-location' || !userId) {
      setParkedCarts([]);
      return () => { current = false; };
    }
    void localDB.parkedCarts.where('organizationId').equals(organizationId)
      .filter(saved => saved.locationId === locationId && saved.createdBy === userId)
      .sortBy('updatedAt')
      .then(rows => { if (current) setParkedCarts(rows.reverse()); })
      .catch(() => { if (current) setNotice('Saved carts could not be loaded on this device.'); });
    return () => { current = false; };
  }, [organizationId, locationId, userId]);

  const cartLines = useMemo(() => cart.flatMap(line => {
    const product = productById.get(line.productId);
    return product ? [{ product, quantity: line.quantity }] : [];
  }), [cart, productById]);

  const totals = useMemo(() => {
    try { return calculateCartTotals(cartLines); }
    catch { return { subtotalMinor: 0, totalMinor: 0, itemCount: 0, unitCount: 0 }; }
  }, [cartLines]);

  const selectedCustomer = customers.find(customer => customer.id === selectedCustomerId);
  const location = locations.find(item => item.id === locationId);

  const findByCode = useCallback((value: string) => {
    const code = value.trim().toLocaleLowerCase();
    if (!code) return null;
    const matches = activeProducts.filter(product =>
      product.barcode?.trim().toLocaleLowerCase() === code ||
      product.sku.trim().toLocaleLowerCase() === code,
    );
    return matches.length === 1 ? matches[0] : null;
  }, [activeProducts]);

  const addToCart = useCallback(async (product: Product, requestedQuantity = 1) => {
    setNotice('');
    if (!product.active) { setNotice('This product is archived and cannot be sold.'); return; }
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
      setNotice('Enter a whole-number quantity greater than zero.'); return;
    }
    const available = stock[product.id] ?? await getLocalStock(locationId, product.id);
    setStock(previous => ({ ...previous, [product.id]: available }));
    const current = cart.find(line => line.productId === product.id)?.quantity ?? 0;
    if (current + requestedQuantity > available) {
      setNotice(`Only ${available} ${product.unit} available for ${product.name}.`);
      return;
    }
    setCart(previous => {
      const existing = previous.find(line => line.productId === product.id);
      return existing
        ? previous.map(line => line.productId === product.id ? { ...line, quantity: line.quantity + requestedQuantity } : line)
        : [...previous, { productId: product.id, quantity: requestedQuantity }];
    });
    setDraftQuantities(previous => ({ ...previous, [product.id]: '1' }));
    setQuery('');
    searchRef.current?.focus();
  }, [cart, locationId, stock]);

  const handleBarcode = useCallback((barcode: string) => {
    const product = findByCode(barcode);
    if (!product) {
      setQuery(barcode);
      setNotice('No active product matches that barcode. Check the code or register the product first.');
      setScannerOpen(false);
      return;
    }
    void addToCart(product, 1);
    setScannerOpen(false);
  }, [addToCart, findByCode]);

  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const exact = findByCode(query);
    if (exact) {
      event.preventDefault();
      void addToCart(exact, 1);
    }
  };

  const changeQuantity = async (product: Product, nextQuantity: number) => {
    if (nextQuantity <= 0) {
      setCart(previous => previous.filter(line => line.productId !== product.id));
      return;
    }
    const available = stock[product.id] ?? await getLocalStock(locationId, product.id);
    if (nextQuantity > available) {
      setNotice(`Only ${available} ${product.unit} available for ${product.name}.`);
      return;
    }
    setCart(previous => previous.map(line => line.productId === product.id ? { ...line, quantity: nextQuantity } : line));
    setNotice('');
  };

  const saveCart = async () => {
    if (!cart.length || !locationId || locationId === 'no-location') return;
    const saved: ParkedCart = {
      id: uid(), organizationId, locationId, createdBy: userId,
      label: selectedCustomer?.name || `Sale · ${new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`,
      customerId: selectedCustomerId || undefined,
      items: cart.map(line => ({ productId: line.productId, quantity: line.quantity })),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    try {
      await localDB.parkedCarts.put(saved);
      setParkedCarts(previous => [saved, ...previous]);
      setCart([]);
      setSelectedCustomerId('');
      setParkedOpen(true);
      setNotice('Cart saved on this device.');
    } catch {
      setNotice('Could not save this cart. Your current cart is unchanged.');
    }
  };

  const resumeCart = async (saved: ParkedCart) => {
    if (cart.length) { setNotice('Park or clear the current cart before restoring another sale.'); return; }
    const restored: CartLine[] = [];
    for (const line of saved.items) {
      const product = productById.get(line.productId);
      if (!product?.active) continue;
      const available = stock[product.id] ?? await getLocalStock(locationId, product.id);
      if (available > 0) restored.push({ productId: product.id, quantity: Math.min(line.quantity, available) });
    }
    if (!restored.length) {
      setNotice('None of the saved products are currently available at this location.');
      return;
    }
    setCart(restored);
    setSelectedCustomerId(saved.customerId ?? '');
    await localDB.parkedCarts.delete(saved.id);
    setParkedCarts(previous => previous.filter(item => item.id !== saved.id));
    setParkedOpen(false);
    setNotice('Saved cart restored. Quantities were checked against current stock.');
  };

  const deleteParkedCart = async (saved: ParkedCart) => {
    await localDB.parkedCarts.delete(saved.id);
    setParkedCarts(previous => previous.filter(item => item.id !== saved.id));
  };

  const completeCheckout = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const sale = await onCheckout({
        items: cart.map(line => ({ ...line })),
        customerId: selectedCustomerId || undefined,
        paymentMethod,
      });
      const lines = cartLines.map(line => ({
        product: line.product, quantity: line.quantity, unitPriceMinor: line.product.retailPriceMinor,
      }));
      setReceipt({ sale, lines });
      setCart([]);
      setSelectedCustomerId('');
      setCheckoutOpen(false);
      setQuery('');
      setNotice('Sale recorded. The receipt is ready.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The sale could not be completed. Review stock and try again.');
    } finally {
      setBusy(false);
    }
  };

  const openPreviousReceipt = (sale: Sale) => {
    const lines = saleItems.filter(item => item.saleId === sale.id).flatMap(item => {
      const product = productById.get(item.productId);
      return product ? [{ product, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor }] : [];
    });
    if (!lines.length) {
      setNotice('Receipt items are not available on this device yet. Connect to the internet and sync, then try again.');
      return;
    }
    setReceipt({ sale, lines });
  };

  const printReceipt = () => window.print();

  return <div className="staff-shell">
    <header className="staff-header">
      <div className="staff-brand">
        <span className="staff-brand-mark">V</span>
        <span><strong>THE VERGE</strong><small>Point of sale</small></span>
      </div>
      <div className="staff-context">
        {organizations.length > 1
          ? <label><span>BUSINESS</span><select value={organizationId} disabled={cart.length > 0} onChange={event => void onOrganizationChange(event.target.value)}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          : <div className="staff-context-name"><span>BUSINESS</span><strong>{organizationName}</strong></div>}
        {locations.length > 1
          ? <label><span>LOCATION</span><select value={locationId} disabled={cart.length > 0} onChange={event => onLocationChange(event.target.value)}>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          : <div className="staff-context-name"><span>LOCATION</span><strong>{location?.name ?? 'No location assigned'}</strong></div>}
      </div>
      <div className="staff-header-actions">
        <span className={online ? 'staff-network is-online' : 'staff-network is-offline'}><i/>{online ? 'Online' : 'Offline'}</span>
        <button className="staff-logout" onClick={() => void onLogout()}><Icon name="logout"/> <span>Sign out</span></button>
      </div>
    </header>

    <main className="staff-main">
      <div className="staff-welcome">
        <div><p className="staff-kicker">CASHIER WORKSPACE</p><h1>Checkout</h1><p>Find products, scan barcodes and build the customer's cart.</p></div>
        <div className="staff-operator"><span className="staff-avatar">{userEmail.slice(0, 1).toUpperCase()}</span><span><strong>{userEmail}</strong><small>Cashier · {pending} changes waiting to sync</small></span></div>
      </div>

      {!online && <div className="staff-offline-notice"><Icon name="wifi"/> Offline mode is active. Sales are saved on this device and will sync when the connection returns. Stock conflicts from other devices may need review.</div>}
      {notice && <div className="staff-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}

      <div className="staff-pos-layout">
        <section className="staff-catalogue">
          <div className="staff-search-row">
            <label className="staff-search">
              <Icon name="search"/>
              <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleSearchKey} placeholder="Search name, SKU or scan barcode…" autoComplete="off"/>
              {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={16}/></button>}
            </label>
            <button className="staff-scan-btn" type="button" onClick={() => setScannerOpen(true)}><Icon name="scan"/> <span>Scan</span></button>
          </div>
          <div className="staff-catalogue-meta"><strong>{resultProducts.length}</strong> products shown <span>·</span> scan again to increase quantity</div>
          <div className="staff-product-list">
            {resultProducts.map(product => {
              const stockKnown = stock[product.id] !== undefined;
              const available = stock[product.id] ?? 0;
              const inCart = cart.find(line => line.productId === product.id)?.quantity ?? 0;
              const draft = draftQuantities[product.id] ?? '1';
              const canAdd = available > inCart;
              return <article className="staff-product" key={product.id}>
                <div className="staff-product-art"><Icon name="box" size={23}/></div>
                <div className="staff-product-main">
                  <strong>{product.name}</strong>
                  <small>{product.sku}{product.barcode ? ` · ${product.barcode}` : ''}</small>
                  <span className={stockKnown && available <= (product.reorderLevel ?? 0) ? 'staff-stock is-low' : 'staff-stock'}>{stockKnown ? `${available} ${product.unit} available` : 'Checking stock…'}{inCart ? ` · ${inCart} in cart` : ''}</span>
                </div>
                <div className="staff-product-action">
                  <strong>{money(product.retailPriceMinor)}</strong>
                  <div className="staff-add-row">
                    <input aria-label={`Quantity for ${product.name}`} type="number" min="1" step="1" inputMode="numeric" value={draft} onChange={event => setDraftQuantities(previous => ({ ...previous, [product.id]: event.target.value }))}/>
                    <button type="button" disabled={!stockKnown || !canAdd} onClick={() => void addToCart(product, Number(draft))}>Add</button>
                  </div>
                </div>
              </article>;
            })}
            {!resultProducts.length && <div className="staff-empty"><Icon name="box" size={28}/><strong>{normalizedQuery ? 'No matching product' : 'No active products yet'}</strong><span>{normalizedQuery ? 'Check the spelling or scan the product barcode again.' : 'Ask the business owner to add products to this location.'}</span></div>}
          </div>
          {resultProducts.length === 48 && <p className="staff-list-limit">Showing the first 48 matches. Refine your search to narrow the list.</p>}
        </section>

        <aside className="staff-cart-panel">
          <div className="staff-cart-heading"><div><p className="staff-kicker">CURRENT SALE</p><h2>Cart <span>{totals.unitCount}</span></h2></div><button type="button" className="staff-text-btn" disabled={!cart.length} onClick={() => { setCart([]); setSelectedCustomerId(''); }}>Clear</button></div>
          <label className="staff-customer-field"><span>Customer (optional)</span><select value={selectedCustomerId} onChange={event => setSelectedCustomerId(event.target.value)}><option value="">Walk-in customer</option>{customers.filter(customer => customer.active).map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}</select></label>
          <div className="staff-cart-lines">
            {cartLines.map(({ product, quantity }) => <div className="staff-cart-line" key={product.id}>
              <div className="staff-cart-line-main"><strong>{product.name}</strong><small>{money(product.retailPriceMinor)} each</small></div>
              <div className="staff-quantity-control">
                <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => void changeQuantity(product, quantity - 1)}><Icon name="minus" size={15}/></button>
                <span>{quantity}</span>
                <button type="button" aria-label={`Increase ${product.name} quantity`} disabled={quantity >= (stock[product.id] ?? 0)} onClick={() => void changeQuantity(product, quantity + 1)}><Icon name="plus" size={15}/></button>
              </div>
              <strong className="staff-line-total">{money(product.retailPriceMinor * quantity)}</strong>
            </div>)}
            {!cart.length && <div className="staff-cart-empty"><Icon name="cart" size={28}/><strong>Your cart is empty</strong><span>Scan a barcode or add a product to get started.</span></div>}
          </div>
          <div className="staff-cart-summary">
            <div><span>Products</span><strong>{totals.itemCount}</strong></div>
            <div><span>Total units</span><strong>{totals.unitCount}</strong></div>
            <div className="staff-cart-total"><span>Total due</span><strong>{money(totals.totalMinor)}</strong></div>
          </div>
          <div className="staff-cart-actions">
            <button type="button" className="staff-park-btn" disabled={!cart.length || busy} onClick={() => void saveCart()}><Icon name="pause"/> Park cart</button>
            <button type="button" className="staff-checkout-btn" disabled={!cart.length || busy} onClick={() => setCheckoutOpen(true)}>Checkout <span>{money(totals.totalMinor)}</span></button>
          </div>
          <button type="button" className="staff-parked-toggle" onClick={() => setParkedOpen(value => !value)}><Icon name="clock" size={17}/> Parked carts <span>{parkedCarts.length}</span></button>
          {parkedOpen && <div className="staff-parked-list">
            {!parkedCarts.length && <p>No parked carts on this device.</p>}
            {parkedCarts.map(saved => <div className="staff-parked-item" key={saved.id}><button type="button" onClick={() => void resumeCart(saved)}><strong>{saved.label}</strong><small>{saved.items.length} product lines · {dateTime(saved.updatedAt)}</small></button><button type="button" aria-label="Delete parked cart" onClick={() => void deleteParkedCart(saved)}><Icon name="close" size={16}/></button></div>)}
          </div>}
        </aside>
      </div>

      <section className="staff-transactions">
        <div className="staff-transactions-heading"><div><p className="staff-kicker">REGISTER ACTIVITY</p><h2>Recent transactions</h2></div><span>{sales.length} recent</span></div>
        {sales.length
          ? <div className="staff-transaction-list">{sales.slice(0, 12).map(sale => <article className="staff-transaction" key={sale.id}>
              <div className="staff-transaction-icon"><Icon name="receipt"/></div>
              <div className="staff-transaction-info"><strong>{money(sale.totalMinor)}</strong><small>{dateTime(sale.occurredAt)} · {sale.paymentMethod}</small></div>
              <span className={sale.syncState === 'synced' ? 'staff-sync-pill is-synced' : 'staff-sync-pill'}>{sale.syncState === 'synced' ? 'Synced' : sale.syncState === 'conflict' ? 'Needs review' : 'Pending sync'}</span>
              <button type="button" className="staff-view-receipt" onClick={() => openPreviousReceipt(sale)}>Receipt</button>
            </article>)}</div>
          : <p className="staff-no-transactions">Completed sales will appear here.</p>}
      </section>
      <footer className="staff-footer"><span>THE VERGE · Powered by Timzee Corp</span><span>{location?.name ?? 'No location'} · {online ? 'Connected' : 'Offline'} · Device {userId.slice(0, 6).toUpperCase()}</span></footer>
    </main>

    {scannerOpen && <Suspense fallback={<div className="staff-modal-backdrop"><div className="staff-modal">Starting camera scanner…</div></div>}><BarcodeScanner onDetected={handleBarcode} onClose={() => setScannerOpen(false)}/></Suspense>}

    {checkoutOpen && <div className="staff-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setCheckoutOpen(false); }}>
      <section className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-checkout-title">
        <div className="staff-modal-heading"><div><p className="staff-kicker">PAYMENT</p><h2 id="staff-checkout-title">Complete sale</h2></div><button type="button" className="staff-close-btn" aria-label="Close checkout" disabled={busy} onClick={() => setCheckoutOpen(false)}><Icon name="close"/></button></div>
        <div className="staff-payment-total"><span>Amount due</span><strong>{money(totals.totalMinor)}</strong></div>
        <label className="staff-modal-field"><span>Payment method</span><select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="card">Card / POS terminal</option><option value="bank">Bank</option></select></label>
        {(paymentMethod === 'transfer' || paymentMethod === 'bank') && <p className="staff-payment-hint">Confirm that the funds have reached the business account before completing this sale. This records the selected payment method; it does not independently verify a bank transaction.</p>}
        {paymentMethod === 'card' && <p className="staff-payment-hint">Complete the card payment on the connected terminal before recording the sale. This screen does not initiate or verify a card charge.</p>}
        <div className="staff-checkout-lines">{cartLines.map(line => <div key={line.product.id}><span>{line.quantity} × {line.product.name}</span><strong>{money(line.product.retailPriceMinor * line.quantity)}</strong></div>)}</div>
        <button type="button" className="staff-checkout-confirm" disabled={busy || !cart.length} onClick={() => void completeCheckout()}>{busy ? 'Recording sale…' : `Confirm sale · ${money(totals.totalMinor)}`}</button>
        <p className="staff-modal-footnote">The sale, all line items and stock deductions are committed together. A rejected stock check will not create a partial sale.</p>
      </section>
    </div>}

    {receipt && <div className="staff-modal-backdrop staff-receipt-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReceipt(null); }}>
      <section className="staff-modal staff-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="staff-receipt-title">
        <div className="staff-modal-heading no-print"><div><p className="staff-kicker">SALE COMPLETED</p><h2 id="staff-receipt-title">Receipt</h2></div><button type="button" className="staff-close-btn" aria-label="Close receipt" onClick={() => setReceipt(null)}><Icon name="close"/></button></div>
        <div className="pos-receipt-print">
          <div className="pos-receipt-brand"><span>THE VERGE</span><small>Powered by Timzee Corp</small></div>
          <h3>Sales receipt</h3>
          <p className="pos-receipt-meta">Receipt #{receipt.sale.id.slice(0, 8).toUpperCase()}<br/>{dateTime(receipt.sale.occurredAt)}<br/>{location?.name ?? 'Business location'}</p>
          <div className="pos-receipt-items">{receipt.lines.map((line, index) => <div className="pos-receipt-line" key={`${line.product.id}-${index}`}><span>{line.product.name}<small>{line.quantity} × {money(line.unitPriceMinor)}</small></span><strong>{money(line.quantity * line.unitPriceMinor)}</strong></div>)}</div>
          <div className="pos-receipt-total"><span>Total paid</span><strong>{money(receipt.sale.totalMinor)}</strong></div>
          <p className="pos-receipt-meta">Payment: {receipt.sale.paymentMethod}<br/>Record: {receipt.sale.syncState==='synced'?'Synced to business server':'Pending server sync'}<br/>Cashier: {userEmail}</p>
          <p className="pos-receipt-thanks">{receipt.sale.syncState==='synced'?'Thank you for shopping with us.':'OFFLINE RECORD · AWAITING SERVER SYNC'}</p>
        </div>
        <div className="staff-receipt-actions no-print"><button type="button" className="staff-park-btn" onClick={printReceipt}><Icon name="printer"/> Print receipt</button><button type="button" className="staff-checkout-confirm" onClick={() => setReceipt(null)}>New sale</button></div>
      </section>
    </div>}
  </div>;
}
