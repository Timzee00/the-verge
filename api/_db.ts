import { neon, Pool } from '@neondatabase/serverless';

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

export function db() {
  return neon(connectionString());
}

/**
 * Creates a short-lived WebSocket-backed pool for operations that genuinely
 * need interactive transaction semantics (multiple statements with decisions
 * between them). Keep the pool scoped to the request and close it in finally.
 */
export function transactionPool() {
  return new Pool({ connectionString: connectionString(), max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
}
