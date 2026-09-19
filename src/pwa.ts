export interface OfflineSession {
  userId: string;
  organizationId: string;
  organizationName: string;
  savedAt: string;
}

const OFFLINE_SESSION_KEY = 'the-verge-offline-session';

export function getOfflineSession(): OfflineSession | null {
  try {
    const raw = localStorage.getItem(OFFLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSession>;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.organizationId !== 'string' ||
      typeof parsed.organizationName !== 'string'
    ) return null;
    return {
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      organizationName: parsed.organizationName,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function rememberOfflineSession(session: Omit<OfflineSession, 'savedAt'>): void {
  try {
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({
      ...session,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Best-effort only; authentication remains server-backed online.
  }
}

export function clearOfflineSession(): void {
  try {
    localStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function registerTheVergePWA(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await requestPersistentStorage();
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    // The app remains usable as a normal web app if service workers are unavailable.
  }
}
