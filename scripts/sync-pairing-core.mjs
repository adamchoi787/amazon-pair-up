// Refreshes vendor/pairing-core from a checkout of the pairing-core repo, so a
// fresh clone of AmazonPairUp runs without a Rust toolchain.
// Usage: node scripts/sync-pairing-core.mjs [path/to/pairing-core]   (default ../pairing-core)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(process.argv[2] ?? process.env.PAIRING_CORE_DIR ?? "../pairing-core");
const dest = resolve("vendor/pairing-core");

execFileSync("node", ["build.mjs"], { cwd: resolve(src, "js"), stdio: "inherit" });
mkdirSync(dest, { recursive: true });
for (const [from, to] of [
  ["js/index.js", "index.js"],
  ["js/index.d.ts", "index.d.ts"],
  ["js/package.json", "package.json"],
  ["js/pairing_core.wasm", "pairing_core.wasm"],
  ["tests/vectors.csv", "vectors.csv"],
  ["LICENSE", "LICENSE"],
]) copyFileSync(resolve(src, from), resolve(dest, to));
const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: src }).toString().trim();
console.log(`vendor/pairing-core synced from ${src} @ ${rev}`);
