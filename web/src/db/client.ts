import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * One small connection pool per server process. `prepare: false` keeps it compatible with
 * Neon's pooled (PgBouncer) connection string.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { nbaSql?: ReturnType<typeof postgres>; nbaDb?: Db };

export class DatabaseNotConfigured extends Error {
  constructor() {
    super("DATABASE_URL is not set");
  }
}

export function getDb(): Db {
  if (globalForDb.nbaDb) return globalForDb.nbaDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfigured();
  const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  const db = drizzle(client, { schema });
  globalForDb.nbaSql = client;
  globalForDb.nbaDb = db;
  return db;
}
