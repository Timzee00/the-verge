import { localDB } from '../db/local';
export interface SyncResult { ok: boolean; conflict?: boolean; error?: string; }
export async function syncPending(push: (op: unknown) => Promise<SyncResult>) {
  const now = new Date().toISOString(); const pending = await localDB.syncOperations.where('state').equals('pending').toArray();
  let synced=0, conflicts=0, failed=0;
  for (const op of pending.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))) {
    if (op.nextAttemptAt && op.nextAttemptAt > now) continue;
    try {
      const result = await push(op); const attempts = op.attempts + 1;
      if (result.ok) { await localDB.syncOperations.update(op.id,{state:'synced',attempts}); if(op.entity==='inventory_event') await localDB.inventoryEvents.update(op.entityId,{syncState:'synced'}); synced++; }
      else if(result.conflict) { await localDB.syncOperations.update(op.id,{state:'conflict',attempts,lastError:result.error??'Conflict'}); if(op.entity==='inventory_event') await localDB.inventoryEvents.update(op.entityId,{syncState:'conflict'}); conflicts++; }
      else { const backoffMs=Math.min(60_000,1000*2**Math.min(attempts,6)); await localDB.syncOperations.update(op.id,{attempts,lastError:result.error??'Sync failed',nextAttemptAt:new Date(Date.now()+backoffMs).toISOString()}); failed++; }
    } catch(error) { const attempts=op.attempts+1; const backoffMs=Math.min(60_000,1000*2**Math.min(attempts,6)); await localDB.syncOperations.update(op.id,{attempts,lastError:String(error),nextAttemptAt:new Date(Date.now()+backoffMs).toISOString()}); failed++; }
  }
  return {synced,conflicts,failed};
}
