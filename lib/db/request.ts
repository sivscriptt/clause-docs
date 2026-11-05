import "server-only";
import { after } from "next/server";
import pg from "pg";
import { cache } from "react";

/**
 * One read connection per page request, shared by the layout, the page and its
 * metadata. Queries are queued so concurrent server components never overlap
 * on the socket. Writes don't use this: they go through withDb + tx.
 */
export const requestDb = cache(async (): Promise<pg.Client> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  client.on("error", () => {});
  const t0 = Date.now();
  await client.connect();
  if (process.env.DB_TIMING) console.log(`request db connect ${Date.now() - t0}ms`);
  after(() => {
    if (process.env.DB_TIMING) console.log(`request db total ${Date.now() - t0}ms`);
    return client.end().catch(() => {});
  });

  let tail: Promise<unknown> = Promise.resolve();
  const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
  (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
    const run = tail.then(() => query(...args));
    tail = run.catch(() => {});
    return run;
  };
  return client;
});
