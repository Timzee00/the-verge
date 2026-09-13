export type ConsentCategory = 'necessary'|'analytics'|'personalization'|'marketing';
import type { ConsentRecord } from '../core/types.js';
export function validateConsent(record: ConsentRecord): void { if (!record.version || !record.decidedAt || record.necessary !== true) throw new Error('Invalid consent record'); }
