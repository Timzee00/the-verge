export const EXPORT_FORMAT_VERSION = 3;
export interface AccountExportEnvelope { format:'the-verge-account'; version:number; exportedAt:string; sections:string[]; data:Record<string,unknown>; }
export function validateImportEnvelope(value: unknown): AccountExportEnvelope {
  if (!value || typeof value !== 'object') throw new Error('Invalid export file');
  const v = value as Partial<AccountExportEnvelope>;
  if (v.format !== 'the-verge-account' || typeof v.version !== 'number' || v.version < 1 || !Array.isArray(v.sections) || !v.data || typeof v.data !== 'object') throw new Error('Unsupported account export');
  return value as AccountExportEnvelope;
}
