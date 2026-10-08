export const CORE_BUSINESS_MODULES = [
  'pos','inventory','customers','suppliers','purchasing','expenses','accounting','reports',
  'staff','multi_location','offline_sync','receipts','audit','exports','notifications'
] as const;

export type BusinessModule =
  | typeof CORE_BUSINESS_MODULES[number]
  | 'barcode'|'variants'|'loyalty'|'credit_debt'|'online_store'|'wholesale'
  | 'batch_expiry'|'pharmacy_controls'|'prescriptions'
  | 'restaurant_tables'|'kitchen_display'|'menu_modifiers'
  | 'appointments'|'jobs'
  | 'rooms_bookings'
  | 'property_crm'
  | 'clinic_records'
  | 'print_jobs'
  | 'production';

const vertical: Record<string,BusinessModule[]> = {
  'retail / general':['barcode','variants','loyalty','credit_debt','online_store'],
  supermarket:['barcode','variants','loyalty','credit_debt','online_store','wholesale','batch_expiry'],
  pharmacy:['barcode','loyalty','credit_debt','batch_expiry','pharmacy_controls','prescriptions'],
  'hospital / clinic':['clinic_records','appointments','pharmacy_controls','batch_expiry','credit_debt'],
  'printing shop':['print_jobs','jobs','production','credit_debt'],
  'restaurant / food':['restaurant_tables','kitchen_display','menu_modifiers','loyalty','online_store','batch_expiry'],
  fashion:['barcode','variants','loyalty','online_store'],
  'student business':['barcode','online_store','credit_debt'],
  'real estate':['property_crm','appointments','credit_debt'],
  services:['appointments','jobs','credit_debt'],
  other:['credit_debt']
};

export function normalizeBusinessType(value:string){
  return value.trim().toLowerCase();
}
export function recommendedModules(industry:string):BusinessModule[]{
  const extra=vertical[normalizeBusinessType(industry)]??vertical.other;
  return Array.from(new Set<BusinessModule>([...CORE_BUSINESS_MODULES,...extra]));
}
export function hasRecommendedModule(industry:string,module:BusinessModule){
  return recommendedModules(industry).includes(module);
}
