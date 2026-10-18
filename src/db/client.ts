import { mkdirSync } from "node:fs";
import type { Config } from "../config.js";
import { schemaSql } from "./schema.js";

// One tiny interface over both backends, so the rest of the code never cares
// whether it runs on embedded PGlite (local dev, tests) or real Postgres (deploy).
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export async function openDb(
  cfg: Pick<Config, "databaseUrl" | "pgliteDir" | "embeddingDim">,
  opts: { inMemory?: boolean } = {},
): Promise<Db> {
  let db: Db;
  if (cfg.databaseUrl && !opts.inMemory) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: cfg.databaseUrl });
    db = {
      query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    if (!opts.inMemory) mkdirSync(cfg.pgliteDir, { recursive: true });
    const lite = await PGlite.create(opts.inMemory ? undefined : cfg.pgliteDir, {
      extensions: { vector },
    });
    db = {
      query: async (sql, params) => lite.query(sql, params) as never,
      close: () => lite.close(),
    };
  }
  await migrate(db, cfg.embeddingDim);
  return db;
}

async function migrate(db: Db, dim: number) {
  // Run statements one by one: parameterless multi-statement strings work on
  // both backends, but splitting gives clearer errors.
  for (const stmt of schemaSql(dim).split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}

/** pgvector literal, e.g. "[0.1,0.2]". */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
