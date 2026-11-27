import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { parseMajorToMinor } from '../domain/money';
import type { Location, Product } from '../core/types';
import type {
  ProcurementSnapshot, PurchaseOrderRecord, StockTransferRecord,
} from '../api';
import { api } from '../api';
import { localDB } from '../db/local';

type Props = {
  organizationId: string;
  locations: Location[];
  products: Product[];
  onRefresh: () => Promise<void>;
  mode?: 'owner'|'inventory_staff';
};

type OrderLineDraft = { productId: string; quantity: string; unitCost: string };
type TransferLineDraft = { productId: string; quantity: string };
const emptyOrderLine=():OrderLineDraft=>({productId:'',quantity:'1',unitCost:'0.00'});
const emptyTransferLine=():TransferLineDraft=>({productId:'',quantity:'1'});
const money=(minor:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(Number(minor)/100);
const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-NG',{dateStyle:'medium'}).format(new Date(value));

export default function ProcurementWorkspace({organizationId,locations,products,onRefresh,mode='owner'}:Props) {
  const [snapshot,setSnapshot]=useState<ProcurementSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editingSupplierId,setEditingSupplierId]=useState('');
  const [supplierName,setSupplierName]=useState('');
  const [supplierPhone,setSupplierPhone]=useState('');
  const [supplierEmail,setSupplierEmail]=useState('');
  const [supplierAddress,setSupplierAddress]=useState('');
  const [orderSupplierId,setOrderSupplierId]=useState('');
  const [orderLocationId,setOrderLocationId]=useState('');
  const [expectedAt,setExpectedAt]=useState('');
  const [orderNotes,setOrderNotes]=useState('');
  const [orderLines,setOrderLines]=useState<OrderLineDraft[]>([emptyOrderLine()]);
  const [transferFromId,setTransferFromId]=useState('');
  const [transferToId,setTransferToId]=useState('');
  const [transferNotes,setTransferNotes]=useState('');
  const [transferLines,setTransferLines]=useState<TransferLineDraft[]>([emptyTransferLine()]);
  const [receiveDrafts,setReceiveDrafts]=useState<Record<string,Record<string,string>>>({});
  const [pendingReceiptIds,setPendingReceiptIds]=useState<string[]>([]);
  const [section,setSection]=useState<'suppliers'|'purchases'|'transfers'>(mode==='inventory_staff'?'purchases':'suppliers');

  async function load() {
    setLoading(true);setError('');
    try {
      const data=await api.procurement(organizationId);
      setSnapshot(data);
      const pendingOrder=await localDB.meta.get(`purchaseOrderKey:${organizationId}`);
      if(pendingOrder) {
        try {
          const stored=JSON.parse(pendingOrder.value) as {request?:{supplierId:string;locationId:string;expectedAt:string|null;notes:string;items:Array<{productId:string;quantityOrdered:number;unitCostMinor:number}>}};
          if(stored.request) {
            setOrderSupplierId(stored.request.supplierId);setOrderLocationId(stored.request.locationId);
            setExpectedAt(stored.request.expectedAt??'');setOrderNotes(stored.request.notes);
            setOrderLines(stored.request.items.map(item=>({productId:item.productId,quantity:String(item.quantityOrdered),unitCost:(item.unitCostMinor/100).toFixed(2)})));
          }
        } catch { /* Keep the existing editable draft if local recovery data is malformed. */ }
      }
      const pendingTransfer=await localDB.meta.get(`stockTransferKey:${organizationId}`);
      if(pendingTransfer) {
        try {
          const stored=JSON.parse(pendingTransfer.value) as {request?:{fromLocationId:string;toLocationId:string;notes:string;items:Array<{productId:string;quantity:number}>}};
          if(stored.request) {
            setTransferFromId(stored.request.fromLocationId);setTransferToId(stored.request.toLocationId);
            setTransferNotes(stored.request.notes);
            setTransferLines(stored.request.items.map(item=>({productId:item.productId,quantity:String(item.quantity)})));
          }
        } catch { /* Keep the existing editable draft if local recovery data is malformed. */ }
      }
      setOrderSupplierId(current=>current||data.suppliers.find(item=>item.active)?.id||'');
      setOrderLocationId(current=>current||locations.find(item=>item.active)?.id||'');
      setTransferFromId(current=>current||locations.find(item=>item.active)?.id||'');
      setTransferToId(current=>current||locations.find(item=>item.active&&item.id!==transferFromId)?.id||'');
      const pendingReceipts=await Promise.all(data.purchaseOrders.map(async order=>{
        const saved=await localDB.meta.get(`purchaseReceiptKey:${organizationId}:${order.id}`);
        if(!saved)return null;
        if(order.status==='cancelled') { await localDB.meta.delete(`purchaseReceiptKey:${organizationId}:${order.id}`); return null; }
        try {
          const stored=JSON.parse(saved.value) as {payload?:string};
          const items=stored.payload?JSON.parse(stored.payload) as Array<{purchaseOrderItemId:string;quantityReceived:number}>:[];
          return {orderId:order.id,items};
        } catch { return {orderId:order.id,items:[] as Array<{purchaseOrderItemId:string;quantityReceived:number}>}; }
      }));
      setPendingReceiptIds(pendingReceipts.filter((entry):entry is {orderId:string;items:Array<{purchaseOrderItemId:string;quantityReceived:number}>}=>Boolean(entry)).map(entry=>entry.orderId));
      setReceiveDrafts(previous=>{
        const next={...previous};
        for(const order of data.purchaseOrders) {
          const current={...(next[order.id]??{})};
          for(const item of data.purchaseOrderItems.filter(item=>item.purchaseOrderId===order.id)) {
            if(current[item.id]===undefined)current[item.id]=String(Math.max(0,item.quantityOrdered-item.quantityReceived));
          }
          const pending=pendingReceipts.find(entry=>entry?.orderId===order.id);
          if(pending)for(const item of pending.items)current[item.purchaseOrderItemId]=String(item.quantityReceived);
          next[order.id]=current;
        }
        return next;
      });
    } catch(err) {
      setError(err instanceof Error?err.message:'Procurement records could not be loaded.');
    } finally {setLoading(false);}
  }
  useEffect(()=>{void load();},[organizationId]);
  useEffect(()=>{
    if(!locations.some(item=>item.id===orderLocationId))setOrderLocationId(locations.find(item=>item.active)?.id??'');
    if(!locations.some(item=>item.id===transferFromId))setTransferFromId(locations.find(item=>item.active)?.id??'');
    if(!locations.some(item=>item.id===transferToId&&item.id!==transferFromId))setTransferToId(locations.find(item=>item.active&&item.id!==transferFromId)?.id??'');
  },[locations,orderLocationId,transferFromId,transferToId]);

  const activeSuppliers=useMemo(()=>snapshot?.suppliers.filter(item=>item.active)??[],[snapshot]);
  const activeProducts=useMemo(()=>products.filter(item=>item.active).slice().sort((a,b)=>a.name.localeCompare(b.name)),[products]);
  const orderItems=(order:PurchaseOrderRecord)=>snapshot?.purchaseOrderItems.filter(item=>item.purchaseOrderId===order.id)??[];
  const transferItems=(transfer:StockTransferRecord)=>snapshot?.transferItems.filter(item=>item.transferId===transfer.id)??[];

  async function refreshAfterChange(message:string) {
    setNotice(message);await load();await onRefresh();
  }

  async function createSupplier(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy||!snapshot?.canManage)return;
    setBusy(true);setError('');setNotice('');
    try {
      await api.procurementAction({organizationId,action:editingSupplierId?'update_supplier':'create_supplier',...(editingSupplierId?{supplierId:editingSupplierId}:{}),name:supplierName,phone:supplierPhone,email:supplierEmail,addressLine1:supplierAddress});
      setEditingSupplierId('');setSupplierName('');setSupplierPhone('');setSupplierEmail('');setSupplierAddress('');
      await refreshAfterChange(editingSupplierId?'Supplier details updated.':'Supplier saved.');
    } catch(err) {setError(err instanceof Error?err.message:'Supplier could not be saved.');}
    finally {setBusy(false);}
  }

  function editSupplier(supplier:ProcurementSnapshot['suppliers'][number]) {
    setEditingSupplierId(supplier.id);
    setSupplierName(supplier.name);
    setSupplierPhone(supplier.phone);
    setSupplierEmail(supplier.email);
    setSupplierAddress(supplier.addressLine1);
  }

  async function changeSupplier(supplierId:string,action:'archive_supplier'|'restore_supplier') {
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      await api.procurementAction({organizationId,action,supplierId});
      await refreshAfterChange(action==='archive_supplier'?'Supplier archived.':'Supplier restored.');
    } catch(err) {setError(err instanceof Error?err.message:'Supplier status could not be changed.');}
    finally {setBusy(false);}
  }

  async function createPurchaseOrder(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy||!snapshot?.canManage)return;
    setBusy(true);setError('');setNotice('');
    try {
      const items=orderLines.map(line=>{
        const quantity=Number(line.quantity);
        if(!line.productId||!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Every purchase line needs a product and a positive whole-number quantity.');
        return {productId:line.productId,quantityOrdered:quantity,unitCostMinor:parseMajorToMinor(line.unitCost)};
      });
      if(new Set(items.map(item=>item.productId)).size!==items.length)throw new Error('A product can appear only once in the same purchase order.');
      const request={supplierId:orderSupplierId,locationId:orderLocationId,expectedAt:expectedAt||null,notes:orderNotes,items:items.slice().sort((a,b)=>a.productId.localeCompare(b.productId))};
      const requestPayload=JSON.stringify(request);
      const keyName=`purchaseOrderKey:${organizationId}`;
      const savedKey=await localDB.meta.get(keyName);
      let idempotencyKey:string;
      if(savedKey) {
        const stored=JSON.parse(savedKey.value) as {id:string;payload:string;request:typeof request};
        idempotencyKey=stored.id;
        if(stored.payload!==requestPayload) {
          setOrderSupplierId(stored.request.supplierId);setOrderLocationId(stored.request.locationId);
          setExpectedAt(stored.request.expectedAt??'');setOrderNotes(stored.request.notes);
          setOrderLines(stored.request.items.map(item=>({productId:item.productId,quantity:String(item.quantityOrdered),unitCost:(item.unitCostMinor/100).toFixed(2)})));
          throw new Error('A previous purchase order request is awaiting confirmation. The original details have been restored; retry those exact details before creating another order.');
        }
      } else {
        idempotencyKey=crypto.randomUUID();
        await localDB.meta.put({key:keyName,value:JSON.stringify({id:idempotencyKey,payload:requestPayload,request})});
      }
      await api.procurementAction({organizationId,action:'create_purchase_order',idempotencyKey,...request});
      await localDB.meta.delete(keyName);
      setOrderNotes('');setExpectedAt('');setOrderLines([emptyOrderLine()]);
      await refreshAfterChange('Purchase order created and sent to the supplier workflow.');
    } catch(err) {setError(err instanceof Error?err.message:'Purchase order could not be created.');}
    finally {setBusy(false);}
  }

  async function receivePurchaseOrder(order:PurchaseOrderRecord) {
    if(busy)return;
    const items=orderItems(order).map(item=>({purchaseOrderItemId:item.id,quantityReceived:Number(receiveDrafts[order.id]?.[item.id]??0)})).filter(item=>item.quantityReceived>0);
    if(!items.length){setError('Enter at least one quantity to receive.');return;}
    if(items.some(item=>!Number.isSafeInteger(item.quantityReceived))){setError('Received quantities must be positive whole numbers.');return;}
    setBusy(true);setError('');setNotice('');
    try {
      const keyName=`purchaseReceiptKey:${organizationId}:${order.id}`;
      const requestPayload=JSON.stringify(items.slice().sort((a,b)=>a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)));
      const savedKey=await localDB.meta.get(keyName);
      let idempotencyKey:string;
      if(savedKey) {
        let stored:{id:string;payload:string}|null=null;
        try { stored=JSON.parse(savedKey.value) as {id:string;payload:string}; } catch { stored=null; }
        if(stored?.id&&stored.payload) {
          idempotencyKey=stored.id;
          if(stored.payload!==requestPayload) {
            const original=JSON.parse(stored.payload) as Array<{purchaseOrderItemId:string;quantityReceived:number}>;
            setReceiveDrafts(previous=>({...previous,[order.id]:{...(previous[order.id]??{}),...Object.fromEntries(original.map(item=>[item.purchaseOrderItemId,String(item.quantityReceived)]))}}));
            throw new Error('A previous receipt attempt is awaiting confirmation. The original quantities have been restored; retry those exact quantities before creating another receipt.');
          }
        } else {
          idempotencyKey=savedKey.value;
          await localDB.meta.put({key:keyName,value:JSON.stringify({id:idempotencyKey,payload:requestPayload})});
        }
      } else {
        idempotencyKey=crypto.randomUUID();
        await localDB.meta.put({key:keyName,value:JSON.stringify({id:idempotencyKey,payload:requestPayload})});
      }
      const result=await api.procurementAction({organizationId,action:'receive_purchase_order',purchaseOrderId:order.id,idempotencyKey,items});
      await localDB.meta.delete(keyName);
      await refreshAfterChange(`Goods received. Receipt ${result.receipt?.id??''} is recorded and the inventory ledger has been updated.`);
    } catch(err) {setError(err instanceof Error?err.message:'Purchase receipt could not be recorded. Retry using the same receipt details.');}
    finally {setBusy(false);}
  }

  async function cancelPurchaseOrder(order:PurchaseOrderRecord) {
    if(busy||!window.confirm('Cancel '+order.reference+'? Any goods already received will remain recorded; only the outstanding quantity will be cancelled.'))return;
    setBusy(true);setError('');setNotice('');
    try { await api.procurementAction({organizationId,action:'cancel_purchase_order',purchaseOrderId:order.id}); await refreshAfterChange('Purchase order cancelled.'); }
    catch(err) {setError(err instanceof Error?err.message:'Purchase order could not be cancelled.');}
    finally {setBusy(false);}
  }

  async function cancelTransfer(transfer:StockTransferRecord) {
    if(busy||!window.confirm('Cancel draft '+transfer.reference+'? No stock has been dispatched yet.'))return;
    setBusy(true);setError('');setNotice('');
    try { await api.procurementAction({organizationId,action:'cancel_transfer',transferId:transfer.id}); await refreshAfterChange('Draft transfer cancelled.'); }
    catch(err) {setError(err instanceof Error?err.message:'Transfer could not be cancelled.');}
    finally {setBusy(false);}
  }

  async function createTransfer(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy||!snapshot?.canManage)return;
    setBusy(true);setError('');setNotice('');
    try {
      const items=transferLines.map(line=>{
        const quantity=Number(line.quantity);
        if(!line.productId||!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Every transfer line needs a product and a positive whole-number quantity.');
        return {productId:line.productId,quantity};
      });
      if(new Set(items.map(item=>item.productId)).size!==items.length)throw new Error('A product can appear only once in the same transfer.');
      const request={fromLocationId:transferFromId,toLocationId:transferToId,notes:transferNotes,items:items.slice().sort((a,b)=>a.productId.localeCompare(b.productId))};
      const requestPayload=JSON.stringify(request);
      const keyName=`stockTransferKey:${organizationId}`;
      const savedKey=await localDB.meta.get(keyName);
      let idempotencyKey:string;
      if(savedKey) {
        const stored=JSON.parse(savedKey.value) as {id:string;payload:string;request:typeof request};
        idempotencyKey=stored.id;
        if(stored.payload!==requestPayload) {
          setTransferFromId(stored.request.fromLocationId);setTransferToId(stored.request.toLocationId);
          setTransferNotes(stored.request.notes);
          setTransferLines(stored.request.items.map(item=>({productId:item.productId,quantity:String(item.quantity)})));
          throw new Error('A previous transfer request is awaiting confirmation. The original details have been restored; retry those exact details before creating another transfer.');
        }
      } else {
        idempotencyKey=crypto.randomUUID();
        await localDB.meta.put({key:keyName,value:JSON.stringify({id:idempotencyKey,payload:requestPayload,request})});
      }
      await api.procurementAction({organizationId,action:'create_transfer',idempotencyKey,...request});
      await localDB.meta.delete(keyName);
      setTransferNotes('');setTransferLines([emptyTransferLine()]);
      await refreshAfterChange('Stock transfer created as a draft.');
    } catch(err) {setError(err instanceof Error?err.message:'Transfer could not be created.');}
    finally {setBusy(false);}
  }

  async function advanceTransfer(transfer:StockTransferRecord,action:'dispatch_transfer'|'receive_transfer') {
    if(busy)return;
    const prompt=action==='dispatch_transfer'
      ? `Dispatch ${transfer.reference}? Stock will be deducted from ${transfer.fromLocationName} and placed in transit.`
      : `Confirm receipt of ${transfer.reference} at ${transfer.toLocationName}? Stock will be added to the destination.`;
    if(!window.confirm(prompt))return;
    setBusy(true);setError('');setNotice('');
    try {
      await api.procurementAction({organizationId,action,transferId:transfer.id});
      await refreshAfterChange(action==='dispatch_transfer'?'Transfer dispatched. Stock is now in transit.':'Transfer received. Destination stock has been updated.');
    } catch(err) {setError(err instanceof Error?err.message:'Transfer state could not be updated.');}
    finally {setBusy(false);}
  }

  if(loading&&!snapshot)return <section className="panel procurement-loading">Loading suppliers, purchase orders and transfers…</section>;

  return <section className="panel procurement-panel">
    <div className="procurement-heading">
      <div><span className="eyebrow">SUPPLIERS & STOCK MOVEMENT</span><h2>Purchasing and transfers</h2><p>Purchase orders track supplier deliveries. Transfers deduct stock at dispatch and add it only after the destination confirms receipt.</p></div>
      {loading&&<span className="procurement-loading-label">Refreshing…</span>}
    </div>
    {notice&&<div className="procurement-feedback success" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="Dismiss notice">×</button></div>}
    {error&&<div className="procurement-feedback error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
    <div className="procurement-tabs" role="tablist" aria-label="Procurement sections">
      {mode==='owner'&&<button type="button" role="tab" aria-selected={section==='suppliers'} className={section==='suppliers'?'active':''} onClick={()=>setSection('suppliers')}>Suppliers <span>{snapshot?.suppliers.length??0}</span></button>}
      <button type="button" role="tab" aria-selected={section==='purchases'} className={section==='purchases'?'active':''} onClick={()=>setSection('purchases')}>Purchase orders <span>{snapshot?.purchaseOrders.length??0}</span></button>
      <button type="button" role="tab" aria-selected={section==='transfers'} className={section==='transfers'?'active':''} onClick={()=>setSection('transfers')}>Transfers <span>{snapshot?.transfers.length??0}</span></button>
    </div>

    {section==='suppliers'&&mode==='owner'&&<div className="procurement-content">
      {snapshot?.canManage&&<form className="procurement-form supplier-form" onSubmit={createSupplier}>
        <div className="procurement-form-heading"><div><strong>{editingSupplierId?'Edit supplier':'Add supplier'}</strong><small>Supplier records are shared by all locations in this business.</small></div></div>
        <label>Supplier name<input required maxLength={140} value={supplierName} onChange={e=>setSupplierName(e.target.value)} placeholder="Supplier or company name"/></label>
        <label>Phone<input type="tel" maxLength={40} value={supplierPhone} onChange={e=>setSupplierPhone(e.target.value)} placeholder="+234…"/></label>
        <label>Email<input type="email" maxLength={320} value={supplierEmail} onChange={e=>setSupplierEmail(e.target.value)} placeholder="orders@supplier.com"/></label>
        <label>Address<input maxLength={160} value={supplierAddress} onChange={e=>setSupplierAddress(e.target.value)} placeholder="Street or business address"/></label>
        <div className="supplier-form-actions"><button className="primary" type="submit" disabled={busy||!supplierName.trim()}>{busy?'Saving…':editingSupplierId?'Save supplier changes':'Save supplier'}</button>{editingSupplierId&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setEditingSupplierId('');setSupplierName('');setSupplierPhone('');setSupplierEmail('');setSupplierAddress('');}}>Cancel edit</button>}</div>
      </form>}
      <div className="procurement-list">
        {(snapshot?.suppliers??[]).map(supplier=><article className="procurement-list-card" key={supplier.id}>
          <div><strong>{supplier.name}</strong><small>{[supplier.phone,supplier.email,supplier.addressLine1].filter(Boolean).join(' · ')||'No contact details'}</small><small>Received goods value: {money((snapshot?.purchaseReceipts??[]).filter(receipt=>receipt.supplierId===supplier.id).reduce((sum,receipt)=>sum+receipt.totalCostMinor,0))} · Before supplier payments</small></div>
          <div className="procurement-actions"><span className={supplier.active?'procurement-status active':'procurement-status inactive'}>{supplier.active?'Active':'Archived'}</span>{snapshot?.canManage&&<>{supplier.active&&<button type="button" className="secondary" disabled={busy} onClick={()=>editSupplier(supplier)}>Edit</button>}<button type="button" className="secondary" disabled={busy} onClick={()=>void changeSupplier(supplier.id,supplier.active?'archive_supplier':'restore_supplier')}>{supplier.active?'Archive':'Restore'}</button></>}</div>
        </article>)}
        {!snapshot?.suppliers.length&&<div className="procurement-empty">No suppliers have been added yet.</div>}
      </div>
    </div>}

    {section==='purchases'&&<div className="procurement-content">
      {snapshot?.canManage&&<form className="procurement-form" onSubmit={createPurchaseOrder}>
        <div className="procurement-form-heading"><div><strong>Create purchase order</strong><small>Ordering records the commitment. Inventory and accounts payable change only when goods are received.</small></div></div>
        <div className="procurement-form-grid">
          <label>Supplier<select required value={orderSupplierId} onChange={e=>setOrderSupplierId(e.target.value)}><option value="">Choose supplier</option>{activeSuppliers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Receiving location<select required value={orderLocationId} onChange={e=>setOrderLocationId(e.target.value)}><option value="">Choose location</option>{locations.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Expected delivery<input type="date" value={expectedAt} onChange={e=>setExpectedAt(e.target.value)}/></label>
          <label>Order note<input maxLength={500} value={orderNotes} onChange={e=>setOrderNotes(e.target.value)} placeholder="Optional delivery instructions"/></label>
        </div>
        <div className="procurement-line-editor">
          {orderLines.map((line,index)=><div className="procurement-line" key={index}>
            <label>Product<select required value={line.productId} onChange={e=>setOrderLines(rows=>rows.map((row,i)=>i===index?{...row,productId:e.target.value}:row))}><option value="">Choose product</option>{activeProducts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
            <label>Quantity<input required type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={e=>setOrderLines(rows=>rows.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))}/></label>
            <label>Unit cost (₦)<input required inputMode="decimal" value={line.unitCost} onChange={e=>setOrderLines(rows=>rows.map((row,i)=>i===index?{...row,unitCost:e.target.value}:row))}/></label>
            <button type="button" className="text-btn" disabled={orderLines.length===1} onClick={()=>setOrderLines(rows=>rows.filter((_,i)=>i!==index))} aria-label="Remove purchase line">Remove</button>
          </div>)}
          <button type="button" className="secondary add-procurement-line" onClick={()=>setOrderLines(rows=>[...rows,emptyOrderLine()])}>Add another product</button>
        </div>
        <button className="primary" type="submit" disabled={busy||!orderSupplierId||!orderLocationId||!activeSuppliers.length||!activeProducts.length}>{busy?'Saving order…':'Create purchase order'}</button>
      </form>}
      <div className="procurement-list">
        {(snapshot?.purchaseOrders??[]).map(order=>{
          const items=orderItems(order);
          const pending=order.status!=='cancelled'&&(pendingReceiptIds.includes(order.id)||(order.status!=='received'&&items.some(item=>item.quantityReceived<item.quantityOrdered)));
          return <article className="procurement-order-card" key={order.id}>
            <div className="procurement-order-header"><div><strong>{order.reference}</strong><small>{order.supplierName} · {order.locationName} · {dateLabel(order.orderedAt)}</small></div><span className={'procurement-status '+order.status}>{order.status.replace('_',' ')}</span></div>
            {items.map(item=>{
              const remaining=item.quantityOrdered-item.quantityReceived;
              return <div className="procurement-order-line" key={item.id}>
                <div><strong>{item.productName}</strong><small>{item.sku} · {item.quantityReceived}/{item.quantityOrdered} received · {money(item.unitCostMinor)} each</small></div>
                {pending&&remaining>0&&<label>Receive now<input type="number" min="0" max={remaining} step="1" inputMode="numeric" value={receiveDrafts[order.id]?.[item.id]??String(remaining)} onChange={e=>setReceiveDrafts(previous=>({...previous,[order.id]:{...(previous[order.id]??{}),[item.id]:e.target.value}}))}/></label>}
              </div>;
            })}
            {pending&&snapshot?.canReceive&&<div className="procurement-order-footer"><span>Remaining lines can be received in multiple deliveries.</span><button type="button" className="primary" disabled={busy} onClick={()=>void receivePurchaseOrder(order)}>Record delivery</button></div>}
          {(order.status==='ordered'||order.status==='partially_received')&&!pendingReceiptIds.includes(order.id)&&snapshot?.canManage&&<div className="procurement-order-footer"><span>Cancel the remaining quantity while preserving all goods already received.</span><button type="button" className="secondary" disabled={busy} onClick={()=>void cancelPurchaseOrder(order)}>Cancel remaining</button></div>}
          </article>;
        })}
        {!snapshot?.purchaseOrders.length&&<div className="procurement-empty">No purchase orders yet. Create an order to record an expected supplier delivery.</div>}
      </div>
      <section className="procurement-receipt-history">
        <div className="procurement-form-heading"><div><strong>Recent goods receipts</strong><small>Each receipt updates branch stock and posts a supplier payable journal when the received value is positive.</small></div></div>
        {(snapshot?.purchaseReceipts??[]).length ? <div className="procurement-list">{snapshot!.purchaseReceipts.slice(0,20).map(receipt=>{
          const order=snapshot!.purchaseOrders.find(item=>item.id===receipt.purchaseOrderId);
          const supplier=snapshot!.suppliers.find(item=>item.id===receipt.supplierId);
          const location=locations.find(item=>item.id===receipt.locationId);
          return <article className="procurement-list-card" key={receipt.id}><div><strong>{order?.reference??'Purchase receipt'} · {money(receipt.totalCostMinor)}</strong><small>{supplier?.name??'Supplier'} · {location?.name??'Location'} · {dateLabel(receipt.receivedAt)}</small></div><span className="procurement-status received">Received</span></article>;
        })}</div> : <div className="procurement-empty">No goods receipts have been recorded.</div>}
      </section>
    </div>}

    {section==='transfers'&&<div className="procurement-content">
      {snapshot?.canManage&&<form className="procurement-form" onSubmit={createTransfer}>
        <div className="procurement-form-heading"><div><strong>Create stock transfer</strong><small>Transfers must be dispatched before the destination can receive them.</small></div></div>
        <div className="procurement-form-grid">
          <label>From location<select required value={transferFromId} onChange={e=>setTransferFromId(e.target.value)}><option value="">Source location</option>{locations.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>To location<select required value={transferToId} onChange={e=>setTransferToId(e.target.value)}><option value="">Destination location</option>{locations.filter(item=>item.active&&item.id!==transferFromId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="transfer-note">Note<input maxLength={500} value={transferNotes} onChange={e=>setTransferNotes(e.target.value)} placeholder="Reason or handling instructions"/></label>
        </div>
        <div className="procurement-line-editor">
          {transferLines.map((line,index)=><div className="procurement-line transfer-line" key={index}>
            <label>Product<select required value={line.productId} onChange={e=>setTransferLines(rows=>rows.map((row,i)=>i===index?{...row,productId:e.target.value}:row))}><option value="">Choose product</option>{activeProducts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
            <label>Quantity<input required type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={e=>setTransferLines(rows=>rows.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))}/></label>
            <button type="button" className="text-btn" disabled={transferLines.length===1} onClick={()=>setTransferLines(rows=>rows.filter((_,i)=>i!==index))}>Remove</button>
          </div>)}
          <button type="button" className="secondary add-procurement-line" onClick={()=>setTransferLines(rows=>[...rows,emptyTransferLine()])}>Add another product</button>
        </div>
        <button className="primary" type="submit" disabled={busy||!transferFromId||!transferToId||transferFromId===transferToId||!activeProducts.length}>Create draft transfer</button>
      </form>}
      <div className="procurement-list">
        {(snapshot?.transfers??[]).map(transfer=><article className="procurement-order-card" key={transfer.id}>
          <div className="procurement-order-header"><div><strong>{transfer.reference}</strong><small>{transfer.fromLocationName} → {transfer.toLocationName} · {dateLabel(transfer.createdAt)}</small></div><span className={'procurement-status '+transfer.status}>{transfer.status}</span></div>
          {transferItems(transfer).map(item=><div className="procurement-order-line" key={item.id}><div><strong>{item.productName}</strong><small>{item.sku} · {item.quantity.toLocaleString('en-NG')} units · {money(item.unitCostMinor)} unit cost</small></div></div>)}
          {transfer.status==='draft'&&transfer.canDispatch&&<div className="procurement-order-footer"><span>Dispatch deducts stock from the source and records in-transit value.</span><button type="button" className="primary" disabled={busy} onClick={()=>void advanceTransfer(transfer,'dispatch_transfer')}>Dispatch</button></div>}
          {transfer.status==='draft'&&snapshot?.canManage&&<div className="procurement-order-footer"><span>A draft transfer has not changed stock and can be cancelled.</span><button type="button" className="secondary" disabled={busy} onClick={()=>void cancelTransfer(transfer)}>Cancel draft</button></div>}
          {transfer.status==='dispatched'&&transfer.canReceive&&<div className="procurement-order-footer"><span>Stock is in transit. Confirm the received quantity at destination before closing the transfer.</span><button type="button" className="primary" disabled={busy} onClick={()=>void advanceTransfer(transfer,'receive_transfer')}>Confirm receipt</button></div>}
          {transfer.status==='received'&&<div className="procurement-order-footer"><span>Received at destination{transfer.receivedAt?' · '+dateLabel(transfer.receivedAt):''}</span></div>}
        </article>)}
        {!snapshot?.transfers.length&&<div className="procurement-empty">No stock transfers have been created yet.</div>}
      </div>
    </div>}
  </section>;
}
