import pg from "pg";

export type Db = pg.PoolClient | pg.Client;

/**
 * One client per request. Cloudflare Workers can't share a socket across
 * requests, and a fresh connection to Neon's pooler is cheap.
 */
export async function withDb<T>(fn: (db: pg.Client) => Promise<T>, url = process.env.DATABASE_URL): Promise<T> {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  // On Workers the socket can report "closed" after end(); that's expected, not a failure.
  client.on("error", () => {});
  const t0 = Date.now();
  await client.connect();
  const t1 = Date.now();
  try {
    return await fn(client);
  } finally {
    if (process.env.DB_TIMING) console.log(`db connect ${t1 - t0}ms, work ${Date.now() - t1}ms`);
    await client.end().catch(() => {});
  }
}

export async function tx<T>(db: pg.Client, fn: () => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    const out = await fn();
    await db.query("COMMIT");
    return out;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
