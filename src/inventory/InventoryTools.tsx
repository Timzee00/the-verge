import { lazy, Suspense, useMemo, useState } from 'react';
import { localDB } from '../db/local';
import { getLocalStock } from './ledger';
import type { InventoryEvent, Product, SyncOperation } from '../core/types';
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

type Props = {
  products: Product[];
  organizationId: string;
  locationId: string;
  deviceId: string;
  onBarcode: (value: string) => void;
  onImported: () => Promise<void>;
  notify: (message: string) => void;
};

type ParsedRow = { row: number; name: string; sku: string; barcode?: string; brand?: string; category?: string; unit: string; costMinor: number; sellMinor: number; quantity: number; reorderLevel?: number; errors: string[] };

const aliases: Record<string, string[]> = {
  name: ['product name','name','item','item name','description','product'],
  sku: ['sku','product code','item code','code','stock keeping unit'],
  barcode: ['barcode','ean','upc','gtin','ean13','upc code'],
  brand: ['brand','manufacturer'],
  category: ['category','type','department'],
  unit: ['unit','uom','measure','unit of measure'],
  cost: ['cost','cost price','unit cost','purchase price','buying price'],
  sell: ['selling price','sell price','retail price','price','unit price'],
  quantity: ['quantity','qty','stock','opening stock','stock on hand','opening quantity'],
  reorder: ['reorder level','minimum stock','low stock threshold']
};
const key = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const numericValue = (value: unknown) => typeof value === 'number' ? value : Number(String(value ?? '').replace(/[₦$£€,\s]/g,'').replace(/[^0-9.-]/g,''));
const moneyMinor = (value: unknown) => Math.round(numericValue(value) * 100);
const textValue = (value: unknown) => String(value ?? '').trim();

function mapHeaders(headers: string[]) {
  const mapped: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const index = headers.findIndex(header => names.includes(key(header)));
    if (index >= 0) mapped[field] = index;
  }
  return mapped;
}

async function makeTemplate() {
  const XLSX = await import('xlsx');
  const sample = [{ 'Product Name':'Sample product', SKU:'SKU-001', Barcode:'0123456789012', Brand:'Example brand', Category:'General', Unit:'piece', 'Cost Price':1500, 'Selling Price':2000, 'Opening Stock':10, 'Reorder Level':3 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sample), 'Products');
  XLSX.writeFile(workbook, 'the-verge-product-import-template.xlsx');
}

export default function InventoryTools({products,organizationId,locationId,deviceId,onBarcode,onImported,notify}:Props) {
  const [scannerOpen,setScannerOpen] = useState(false);
  const [rows,setRows] = useState<ParsedRow[]>([]);
  const [fileName,setFileName] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const validRows = useMemo(() => rows.filter(row => row.errors.length === 0),[rows]);
  const invalidRows = rows.length - validRows.length;

  async function exportProducts() {
    try {
      const XLSX = await import('xlsx');
      const stock = await Promise.all(products.map(product => getLocalStock(locationId,product.id)));
      const records = products.map((p,index)=>({
        'Product Name':p.name,SKU:p.sku,Barcode:p.barcode??'',Brand:p.brand??'',Category:p.category??'',Unit:p.unit,
        'Cost Price':p.standardCostMinor/100,'Selling Price':p.retailPriceMinor/100,'Stock On Hand':stock[index],
        'Reorder Level':p.reorderLevel??'','Active':p.active?'Yes':'No'
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(records),'Products');
      XLSX.writeFile(workbook,`the-verge-inventory-${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch { notify('Could not export inventory. Try again.'); }
  }

  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Files must be 10 MB or smaller.'); return; }
    setError(''); setRows([]); setFileName(file.name);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Choose an Excel (.xlsx/.xls) or CSV file.'); return; }
    try {
      const XLSX = await import('xlsx');
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes,{type:'array',cellDates:false});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook has no readable sheet.');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true});
      if (matrix.length < 2) throw new Error('The first sheet needs a header row and at least one product row.');
      const headers = (matrix[0] as unknown[]).map(textValue);
      const mapping = mapHeaders(headers);
      if (mapping.name === undefined) throw new Error('A Product Name or Name column is required.');
      const seenSku = new Set<string>(); const seenBarcode = new Set<string>();
      const parsed = (matrix.slice(1) as unknown[][]).map((cells,index)=>{
        const get=(field:string)=>mapping[field]===undefined?'':cells[mapping[field]!];
        const name=textValue(get('name')); const sku=textValue(get('sku')) || `IMP-${Date.now().toString(36).toUpperCase()}-${index+1}`;
        const barcode=textValue(get('barcode')) || undefined;
        const cost=moneyMinor(get('cost')); const sell=moneyMinor(get('sell')); const quantity=numericValue(get('quantity')||0);
        const reorderRaw=get('reorder'); const reorder=reorderRaw===''?undefined:numericValue(reorderRaw);
        const errors:string[]=[];
        if(!name)errors.push('Product name is missing');
        if(cost<0||!Number.isSafeInteger(cost))errors.push('Cost price must be a valid non-negative amount');
        if(sell<0||!Number.isSafeInteger(sell))errors.push('Selling price must be a valid non-negative amount');
        if(!Number.isFinite(quantity)||quantity<0)errors.push('Opening stock must be zero or greater');
        if(reorder!==undefined&&(!Number.isFinite(reorder)||reorder<0))errors.push('Reorder level must be zero or greater');
        if(products.some(p=>p.sku.toLowerCase()===sku.toLowerCase())||seenSku.has(sku.toLowerCase()))errors.push('Duplicate SKU');
        if(typeof get('barcode')==='number')errors.push('Barcode is numeric in the spreadsheet. Format this column as Text to preserve leading zeros.');
        if(barcode&&(products.some(p=>p.barcode===barcode)||seenBarcode.has(barcode)))errors.push('Duplicate barcode');
        seenSku.add(sku.toLowerCase()); if(barcode)seenBarcode.add(barcode);
        return {row:index+2,name,sku,barcode,brand:textValue(get('brand'))||undefined,category:textValue(get('category'))||undefined,unit:textValue(get('unit'))||'piece',costMinor:cost,sellMinor:sell,quantity,reorderLevel:reorder,errors};
      }).filter(row=>row.name||row.sku||row.barcode||row.quantity>0);
      if(!parsed.length)throw new Error('No product rows were found below the header.');
      if(parsed.length>5000)throw new Error('This import contains more than 5,000 product rows. Split it into smaller files.');
      setRows(parsed);
    } catch (err) { setError(err instanceof Error?err.message:'Could not read this file.'); }
  }

  async function importRows() {
    if(!validRows.length||busy)return;
    setBusy(true); setError('');
    try {
      const createdAt=new Date().toISOString();
      const newProducts:Product[]=[]; const events:InventoryEvent[]=[]; const operations:SyncOperation[]=[];
      await localDB.transaction('rw',[localDB.products,localDB.inventoryEvents,localDB.syncOperations,localDB.meta],async()=>{
        const current=Number((await localDB.meta.get('localSequence'))?.value??Date.now());
        let sequence=current+1;
        for(const row of validRows) {
          const productId=crypto.randomUUID(); const productSequence=sequence++;
          const product:Product={id:productId,organizationId,sku:row.sku,barcode:row.barcode,name:row.name,brand:row.brand,category:row.category,unit:row.unit,standardCostMinor:row.costMinor,retailPriceMinor:row.sellMinor,reorderLevel:row.reorderLevel,active:true,trackBatch:false,trackExpiry:false,createdAt,updatedAt:createdAt};
          newProducts.push(product);
          operations.push({id:crypto.randomUUID(),organizationId,deviceId,entity:'product',entityId:productId,operation:'create',payload:product,createdAt,attempts:0,state:'pending',localSequence:productSequence});
          if(row.quantity>0) {
            const eventSequence=sequence++; const event:InventoryEvent={id:crypto.randomUUID(),organizationId,locationId,productId,type:'opening',quantityDelta:row.quantity,unitCostMinor:row.costMinor,occurredAt:createdAt,deviceId,localSequence:eventSequence,syncState:'pending',createdAt};
            events.push(event);
            operations.push({id:crypto.randomUUID(),organizationId,deviceId,entity:'inventory_event',entityId:event.id,operation:'create',payload:event,createdAt,attempts:0,state:'pending',localSequence:eventSequence});
          }
        }
        await localDB.products.bulkAdd(newProducts);
        if(events.length)await localDB.inventoryEvents.bulkAdd(events);
        await localDB.syncOperations.bulkAdd(operations);
        await localDB.meta.put({key:'localSequence',value:String(sequence-1)});
      });
      setRows([]);setFileName('');await onImported();notify(`Imported ${newProducts.length} products and ${events.length} opening stock records.`);
    } catch(err) { setError(err instanceof Error?err.message:'Import failed. No records were confirmed.'); }
    finally { setBusy(false); }
  }

  return <section className="panel inventory-tools">
    <div className="section-head"><div><span className="eyebrow">BULK DATA</span><h2>Import and export inventory</h2><p>Bring existing spreadsheets in, review the mapping, then confirm clean rows. Export the live catalogue to Excel.</p></div></div>
    <div className="inventory-tool-actions">
      <label className="secondary file-picker"><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>void readFile(e.target.files?.[0])}/>Import Excel / CSV</label>
      <button type="button" className="secondary" onClick={makeTemplate}>Download template</button>
      <button type="button" className="primary" onClick={()=>void exportProducts()}>Export Excel</button>
    </div>
    {fileName&&<p className="muted">Selected: {fileName}</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {rows.length>0&&<div className="import-review">
      <div className="import-summary"><strong>{validRows.length} ready</strong><span>{invalidRows} need attention</span><span>{rows.length} rows detected</span></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Row</th><th>Product</th><th>SKU</th><th>Barcode</th><th>Cost</th><th>Price</th><th>Opening stock</th><th>Validation</th></tr></thead><tbody>{rows.slice(0,100).map(row=><tr key={row.row}><td>{row.row}</td><td>{row.name||'—'}</td><td>{row.sku}</td><td>{row.barcode||'—'}</td><td>{(row.costMinor/100).toLocaleString('en-NG')}</td><td>{(row.sellMinor/100).toLocaleString('en-NG')}</td><td>{row.quantity}</td><td>{row.errors.length?row.errors.join('; '):'Ready'}</td></tr>)}</tbody></table></div>
      {rows.length>100&&<p className="muted">Showing first 100 rows. All {rows.length} rows will be validated and imported.</p>}
      <div className="form-actions"><button type="button" className="primary" disabled={!validRows.length||busy} onClick={()=>void importRows()}>{busy?'Importing…':`Import ${validRows.length} valid products`}</button><button type="button" className="text-btn" onClick={()=>{setRows([]);setFileName('');}}>Cancel</button></div>
    </div>}
    <div className="barcode-quick-action"><div><strong>Barcode scanner</strong><small>Use your device camera, or connect a USB/Bluetooth scanner and scan into the barcode field above.</small></div><button type="button" className="secondary" onClick={()=>setScannerOpen(true)}>Open camera scanner</button></div>
    {scannerOpen&&<Suspense fallback={<div className="scanner-card">Loading camera scanner…</div>}><BarcodeScanner onDetected={value=>{onBarcode(value);setScannerOpen(false);notify('Barcode captured.');}} onClose={()=>setScannerOpen(false)}/></Suspense>}
  </section>;
}
