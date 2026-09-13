import type { SyncOperation } from '../core/types.js';

export function operationFingerprint(operation: Pick<SyncOperation, 'deviceId'|'entity'|'entityId'|'operation'>): string {
  return `${operation.deviceId}:${operation.entity}:${operation.entityId}:${operation.operation}`;
}

export function deduplicateOperations(operations: SyncOperation[]): SyncOperation[] {
  const seen = new Set<string>();
  const result: SyncOperation[] = [];
  for (const operation of operations) {
    const key = operationFingerprint(operation);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(operation);
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function nextRetryAt(attempts: number, now = Date.now()): string {
  const safeAttempts = Math.max(0, Math.min(attempts, 8));
  const delayMs = Math.min(60_000 * (2 ** safeAttempts), 24 * 60 * 60 * 1000);
  return new Date(now + delayMs).toISOString();
}
