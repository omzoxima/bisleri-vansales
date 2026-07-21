import 'dotenv/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/bisleri_vansales',
      // Azure PG flexible server requires SSL; local PG doesn't.
      ssl: process.env.DATABASE_URL?.includes('azure.com')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
      // Azure PG over the public internet: keep sockets warm and fail fast so
      // pg-pool can retry instead of hanging on a dead TCP attempt.
      keepAlive: true,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 120_000,
    });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = drizzle(getPool(), { schema });
  return db;
}

export { schema };
