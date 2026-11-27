import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { parseMajorToMinor } from '../domain/money';
import type { ProcurementSnapshot } from '../api';
import { api } from '../api';
import { localDB } from '../db/local';

type Props = {
  organizationId:string;
  snapshot:ProcurementSnapshot;
  onSaved:()=>Promise<void>;
};
const money=(minor:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(Number(minor)/100);
const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-NG',{dateStyle:'medium'}).format(new Date(value));

export default function SupplierPaymentsPanel({organizationId,snapshot,onSaved}:Props) {
  const [supplierId,setSupplierId]=useState(snapshot.suppliers.find(item=>item.active)?.id??'');
  const [receiptId,setReceiptId]=useState('');
  const [amount,setAmount]=useState('');
  const [paymentMethod,setPaymentMethod]=useState<'cash'|'bank'|'transfer'|'card'>('bank');
  const [reference,setReference]=useState('');
  const [busy,setBusy]=useState(false);
  const [pendingPayment,setPendingPayment]=useState<{key:string;id:string;payload:string;request:{supplierId:string;receiptId:string;amountMinor:number;paymentMethod:'cash'|'bank'|'transfer'|'card';reference?:string}}|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    let live=true;
    const restore=async()=>{
      const prefix=`supplierPaymentKey:${organizationId}:`;
      const record=await localDB.meta.toCollection().filter(item=>item.key.startsWith(prefix)).first();
      if(!record)return;
      try {
        const stored=JSON.parse(record.value) as {id:string;payload:string;request:{supplierId:string;receiptId:string;amountMinor:number;paymentMethod:'cash'|'bank'|'transfer'|'card';reference?:string}};
        if(!stored.id||!stored.payload||!stored.request)return;
        if(live) {
          setPendingPayment({key:record.key,...stored});
          setSupplierId(stored.request.supplierId);
          setReceiptId(stored.request.receiptId);
          setAmount((stored.request.amountMinor/100).toFixed(2));
          setPaymentMethod(stored.request.paymentMethod);
          setReference(stored.request.reference??'');
        }
      } catch { if(live)setError('A pending payment recovery record could not be read. Contact the business owner before retrying the payment.'); }
    };
    void restore().catch(()=>{if(live)setError('A pending payment recovery record could not be loaded.');});
    return()=>{live=false;};
  },[organizationId]);

  const outstandingReceipts=useMemo(
    ()=>snapshot.purchaseReceipts.filter(receipt=>receipt.supplierId===supplierId&&receipt.outstandingMinor>0),
    [snapshot.purchaseReceipts,supplierId],
  );
  const selectedReceipt=snapshot.purchaseReceipts.find(receipt=>receipt.id===receiptId)??outstandingReceipts[0];
  const supplier=snapshot.suppliers.find(item=>item.id===supplierId);
  const supplierTotals=useMemo(()=>snapshot.suppliers.map(item=>{
    const receipts=snapshot.purchaseReceipts.filter(receipt=>receipt.supplierId===item.id);
    return {
      id:item.id,name:item.name,
      received:receipts.reduce((sum,receipt)=>sum+receipt.totalCostMinor,0),
      paid:receipts.reduce((sum,receipt)=>sum+receipt.paidMinor,0),
      outstanding:receipts.reduce((sum,receipt)=>sum+receipt.outstandingMinor,0),
    };
  }),[snapshot.suppliers,snapshot.purchaseReceipts]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      if(!supplierId||!selectedReceipt)throw new Error('Choose a supplier receipt with an outstanding balance.');
      const amountMinor=parseMajorToMinor(amount);
      if(amountMinor<=0)throw new Error('Payment must be greater than zero.');
      const request={
        supplierId,receiptId:selectedReceipt.id,amountMinor,paymentMethod,
        reference:reference.trim()||undefined,
      };
      const payload=JSON.stringify(request);
      const keyName=`supplierPaymentKey:${organizationId}:${selectedReceipt.id}`;
      if(pendingPayment&&pendingPayment.key!==keyName)throw new Error('A previous supplier payment is awaiting confirmation. Retry that exact payment before starting another.');
      const saved=await localDB.meta.get(keyName);
      let idempotencyKey:string;
      if(saved) {
        const stored=JSON.parse(saved.value) as {id:string;payload:string;request:typeof request};
        idempotencyKey=stored.id;
        if(stored.payload!==payload) {
          setSupplierId(stored.request.supplierId);
          setReceiptId(stored.request.receiptId);
          setAmount((stored.request.amountMinor/100).toFixed(2));
          setPaymentMethod(stored.request.paymentMethod);
          setReference(stored.request.reference??'');
          throw new Error('A previous supplier payment is awaiting confirmation. Its original details have been restored; retry those exact details before recording another payment.');
        }
      } else {
        if(amountMinor>selectedReceipt.outstandingMinor)throw new Error('Payment cannot exceed the receipt outstanding balance.');
        idempotencyKey=crypto.randomUUID();
        await localDB.meta.put({key:keyName,value:JSON.stringify({id:idempotencyKey,payload,request})});
      }
      setPendingPayment({key:keyName,id:idempotencyKey,payload,request});
      const result=await api.procurementAction({organizationId,action:'record_supplier_payment',idempotencyKey,...request});
      setNotice(`Payment recorded: ${money(result.supplierPayment?.amountMinor??amountMinor)}. The supplier payable journal has been updated.`);
      await onSaved();
      await localDB.meta.delete(keyName);
      setPendingPayment(null);
      setAmount('');setReference('');
      setReceiptId('');
    } catch(err) {
      setError(err instanceof Error?err.message:'Supplier payment could not be recorded. Retry the same details to safely confirm its status.');
    } finally {setBusy(false);}
  }

  return <div className="supplier-settlement">
    <div className="supplier-settlement-heading">
      <div><span className="eyebrow">ACCOUNTS PAYABLE</span><h3>Supplier balances and payments</h3><p>Pay against a specific goods receipt. A payment reduces the outstanding payable and creates a balanced ledger entry.</p></div>
    </div>
    {notice&&<div className="procurement-feedback success" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="Dismiss message">×</button></div>}
    {error&&<div className="procurement-feedback error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
    <div className="supplier-balance-grid">
      {supplierTotals.map(item=><article key={item.id}>
        <strong>{item.name}</strong>
        <div><span>Received</span><b>{money(item.received)}</b></div>
        <div><span>Paid</span><b>{money(item.paid)}</b></div>
        <div className="supplier-outstanding"><span>Outstanding</span><b>{money(item.outstanding)}</b></div>
      </article>)}
      {!supplierTotals.length&&<div className="procurement-empty">Add a supplier and record a goods receipt to see its payable balance.</div>}
    </div>
    <form className="procurement-form supplier-payment-form" onSubmit={submit}>
      <div className="procurement-form-heading"><div><strong>Record supplier payment</strong><small>Payments are allocated to one receipt at a time, preventing overpayment or unallocated cash entries.</small></div></div>
      <label>Supplier<select required value={supplierId} onChange={event=>{setSupplierId(event.target.value);setReceiptId('');}}><option value="">Choose supplier</option>{snapshot.suppliers.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Outstanding receipt<select required value={selectedReceipt?.id??''} onChange={event=>setReceiptId(event.target.value)}><option value="">Choose receipt</option>{pendingPayment&&snapshot.purchaseReceipts.some(receipt=>receipt.id===pendingPayment.request.receiptId&&!outstandingReceipts.some(item=>item.id===receipt.id))&&<option value={pendingPayment.request.receiptId}>Pending confirmation · {pendingPayment.request.receiptId.slice(0,8)}</option>}{outstandingReceipts.map(receipt=>{const order=snapshot.purchaseOrders.find(item=>item.id===receipt.purchaseOrderId);return <option key={receipt.id} value={receipt.id}>{order?.reference??receipt.id.slice(0,8)} · outstanding {money(receipt.outstandingMinor)}</option>;})}</select></label>
      <label>Amount (₦)<input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="0.00"/></label>
      <label>Payment method<select value={paymentMethod} onChange={event=>setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="transfer">Transfer</option><option value="card">Card</option></select></label>
      <label>Transaction reference<input maxLength={80} value={reference} onChange={event=>setReference(event.target.value)} placeholder="Bank or receipt reference (optional)"/></label>
      {selectedReceipt&&<div className="supplier-payment-hint">Selected receipt outstanding: <strong>{money(selectedReceipt.outstandingMinor)}</strong>{pendingPayment&&pendingPayment.request.receiptId===selectedReceipt.id&&<> · <strong>Retry pending payment</strong></>}{supplier&&<> · Supplier: <strong>{supplier.name}</strong></>}</div>}
      <button className="primary" type="submit" disabled={busy||!selectedReceipt||!amount.trim()}>{busy?'Recording payment…':'Record supplier payment'}</button>
    </form>
    <div className="supplier-payment-history">
      <div className="procurement-form-heading"><div><strong>Recent payments</strong><small>Payments are linked to the receipt they settle.</small></div></div>
      {snapshot.supplierPayments.length?<div className="procurement-list">{snapshot.supplierPayments.slice(0,30).map(payment=><article className="procurement-list-card" key={payment.id}>
        <div><strong>{payment.supplierName} · {money(payment.amountMinor)}</strong><small>{dateLabel(payment.occurredAt)} · {payment.paymentMethod}{payment.reference?' · '+payment.reference:''}</small><small>Receipt {snapshot.purchaseOrders.find(order=>order.id===snapshot.purchaseReceipts.find(receipt=>receipt.id===payment.receiptId)?.purchaseOrderId)?.reference??payment.receiptId.slice(0,8)}</small></div>
        <span className="procurement-status received">Allocated</span>
      </article>)}</div>:<div className="procurement-empty">No supplier payments have been recorded yet.</div>}
    </div>
  </div>;
}
