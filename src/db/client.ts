import { mkdirSync } from "node:fs";
import type { Config } from "../config.js";
import { schemaSql } from "./schema.js";

// One tiny interface over both backends, so the rest of the code never cares
// whether it runs on embedded PGlite (local dev, tests) or real Postgres (deploy).
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** A pinned connection, so row locks and all following reads share a transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  root?: Db;
  afterCommit?(fn: () => void): void;
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
      transaction: async (fn) => {
        const connection = await pool.connect();
        const committed: (() => void)[] = [];
        const tx: Db = {
          root: db, afterCommit: fn => committed.push(fn),
          query: async (sql, params) => connection.query(sql, params as unknown[]) as never,
          transaction: async (nested) => nested(tx),
          close: async () => { throw new Error("Cannot close a transaction connection"); },
        };
        try {
          await connection.query("BEGIN");
          const result = await fn(tx);
          await connection.query("COMMIT");
          for (const notify of committed) notify();
          return result;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally { connection.release(); }
      },
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
      transaction: async (fn) => {
        const committed: (() => void)[] = [];
        const result = await lite.transaction(async (connection) => {
          const tx: Db = {
            root: db, afterCommit: fn => committed.push(fn),
            query: async (sql, params) => connection.query(sql, params) as never,
            transaction: async (nested) => nested(tx),
            close: async () => { throw new Error("Cannot close a transaction connection"); },
          };
          return fn(tx);
        });
        for (const notify of committed) notify();
        return result;
      },
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
