import { createHash } from "node:crypto";
import type { Db } from "../db/client.js";
import { MarketError } from "./service.js";

// Retry-safe writes. Voice hosts and agents retry a call when a response is
// slow or lost; without a key that retry would post a second offer or a
// second request. With an idempotency_key, the first call's result is stored
// and a retry with the same key and arguments gets that result back unchanged.
// Errors are not stored, so a call that failed can be retried as it is.

/** How long a stored result answers retries. */
export const IDEMPOTENCY_TTL_HOURS = 24;

const hashArgs = (args: Record<string, unknown>) => {
  const { idempotency_key: _drop, ...rest } = args;
  return createHash("sha256").update(stableJson(rest)).digest("hex");
};

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function once<T extends object>(
  db: Db,
  scope: { userId: string; tool: string; key?: string; args: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  if (!scope.key) return fn();
  const argsHash = hashArgs(scope.args);
  // Claim the key first, so two copies of the same call arriving together run once.
  const claimed = await db.query(
    `INSERT INTO idempotent_calls (user_id, key, tool, args_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [scope.userId, scope.key, scope.tool, argsHash],
  );
  if (!claimed.rows.length) {
    const { rows } = await db.query<{ tool: string; args_hash: string; result: T | null; created_at: string }>(
      `SELECT tool, args_hash, result, created_at FROM idempotent_calls WHERE user_id = $1 AND key = $2`,
      [scope.userId, scope.key],
    );
    const prior = rows[0];
    if (prior && (prior.tool !== scope.tool || prior.args_hash !== argsHash)) {
      throw new MarketError("That request id was already used for a different action. Please try again.", "idempotency_conflict");
    }
    if (prior?.result) return prior.result;
    throw new MarketError("I'm still working on that. Please ask again in a moment.", "in_progress");
  }
  try {
    const result = await fn();
    await db.query(`UPDATE idempotent_calls SET result = $3 WHERE user_id = $1 AND key = $2`, [
      scope.userId, scope.key, JSON.stringify(result),
    ]);
    return result;
  } catch (err) {
    await db.query(`DELETE FROM idempotent_calls WHERE user_id = $1 AND key = $2`, [scope.userId, scope.key]);
    throw err;
  }
}

/** Drop stored results older than the retry window. */
export async function purgeIdempotentCalls(db: Db, hours = IDEMPOTENCY_TTL_HOURS) {
  const { rows } = await db.query<{ n: number }>(
    `WITH gone AS (DELETE FROM idempotent_calls WHERE created_at < now() - make_interval(hours => $1) RETURNING 1)
     SELECT count(*)::int AS n FROM gone`,
    [hours],
  );
  return rows[0]?.n ?? 0;
}
