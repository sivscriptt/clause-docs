// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... tsx db/migrate.ts [--reset]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export async function migrate(url: string, reset = false) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    if (reset) await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())");
    const dir = join(import.meta.dirname, "migrations");
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const done = await db.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (done.rowCount) continue;
      await db.query("BEGIN");
      await db.query(readFileSync(join(dir, name), "utf8"));
      await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await db.query("COMMIT");
      console.log(`applied ${name}`);
    }
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await migrate(url, process.argv.includes("--reset"));
}
