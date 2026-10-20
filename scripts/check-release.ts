// Read-only release checks: no sign-in, market writes, AWS calls or credentials.
// Compare the hosted release with this checkout before recording or submitting.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:3000" },
  revision: { type: "string" },
  "expect-ai": { type: "string" },
  "expect-auth": { type: "string" },
} });
const base = new URL(values.url!);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Use an HTTP(S) server URL without credentials.");
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const assets = JSON.parse(readFileSync(new URL("../public/build-info.json", import.meta.url), "utf8"));
const checks: { check: string; passed: boolean; detail: string }[] = [];
const record = (check: string, passed: boolean, detail: unknown) => checks.push({ check, passed, detail: String(detail ?? "unavailable") });
async function get(path: string) {
  const response = await fetch(new URL(path, base), { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
await Promise.all([
  (async () => {
    try {
      const h = await (await get("/health")).json();
      record("product", h.product === "PairUp", h.product);
      record("version", h.version === version, `${h.version} (expected ${version})`);
      record("UI fingerprint", h.ui_fingerprint === assets.fingerprint, h.ui_fingerprint);
      if (values.revision) record("deployed commit", h.revision === values.revision, `${h.revision} (expected ${values.revision})`);
      if (values["expect-ai"]) record("AI mode", h.ai === values["expect-ai"] && h.agent === (values["expect-ai"] === "bedrock" ? "bedrock" : "offline"), `${h.ai}/${h.agent}`);
      if (values["expect-auth"]) record("authentication", h.auth === values["expect-auth"], h.auth);
    } catch (e) { record("health", false, (e as Error).message); }
  })(),
  (async () => { try { record("database ready", (await (await get("/ready")).json()).ok === true, "/ready"); } catch (e) { record("database ready", false, (e as Error).message); } })(),
  (async () => {
    try { const html = await (await get("/app/")).text(); record("current app shell", /<title>PairUp<\/title>/.test(html) && html.includes("Your minimum stays private."), "/app/"); }
    catch (e) { record("current app shell", false, (e as Error).message); }
  })(),
  (async () => {
    try { const remote = await (await get("/build-info.json")).json(); record("asset manifest", remote.version === version && remote.fingerprint === assets.fingerprint, remote.fingerprint); }
    catch (e) { record("asset manifest", false, (e as Error).message); }
  })(),
]);
console.log(JSON.stringify({ url: base.origin, passed: checks.every(c => c.passed), checks: checks.sort((a, b) => a.check.localeCompare(b.check)) }, null, 2));
console.log("This verifies release identity and readiness; it does not prove live model calls, account linking, or physical device behavior.");
if (checks.some(c => !c.passed)) process.exitCode = 1;
