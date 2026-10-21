// Tony runs after deployment. This command makes a real model request (AWS
// charges may apply); it never executes the tool calls returned by the model.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { url: { type: "string" }, output: { type: "string", default: "docs/EVIDENCE.md" }, "agentcore-arn": { type: "string" } } });
if (!values.url) throw Error("Usage: npm run evidence -- --url https://your-public-origin [--agentcore-arn ARN]");
const base = new URL(values.url);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw Error("Use an HTTP(S) origin without credentials or query parameters.");
const token = process.env.PAIRUP_TOKEN ?? "";
const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
if (process.env.PAIRUP_USER_ID && ["localhost", "127.0.0.1"].includes(base.hostname)) headers["X-User-Id"] = process.env.PAIRUP_USER_ID;
type Entry = { check: string; passed: boolean; response: unknown };
const entries: Entry[] = [];
const prompt = "Tell me which PairUp tools help me review my existing posts. Do not create or confirm anything.";
async function request(check: string, route: string, body?: unknown) {
  try {
    const r = await fetch(new URL(route, base.origin), { headers, method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    const data = await r.json();
    const passed = r.ok && (check !== "Bedrock inference" || data.inference === "bedrock");
    entries.push({ check, passed, response: { status: r.status, body: data } }); return data;
  } catch (e) { entries.push({ check, passed: false, response: (e as Error).message }); return null; }
}
const health = await request("Health", "/health");
const build = await request("Browser build", "/build-info.json");
const local = JSON.parse(readFileSync("public/build-info.json", "utf8"));
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
entries.push({ check: "Submitted release identity", passed: health?.revision === revision && health?.version === local.version && build?.fingerprint === local.fingerprint, response: { expected_revision: revision, deployed_revision: health?.revision ?? null, expected_fingerprint: local.fingerprint, deployed_fingerprint: build?.fingerprint ?? null } });
await request("Bedrock inference", "/api/agent", { messages: [{ role: "user", content: [{ text: prompt }] }] });

const arn = values["agentcore-arn"] ?? process.env.AGENTCORE_RUNTIME_ARN;
if (arn) {
  const folder = mkdtempSync(path.join(tmpdir(), "pairup-evidence-"));
  try {
    if (!token) throw Error("PAIRUP_TOKEN is required for the hosted AgentCore invocation.");
    const input = path.join(folder, "request.json"), output = path.join(folder, "response.txt");
    writeFileSync(input, JSON.stringify({ prompt, pairup_token: token }));
    execFileSync("aws", ["bedrock-agentcore", "invoke-agent-runtime", "--agent-runtime-arn", arn, "--runtime-session-id", `pairup-evidence-${randomUUID()}`, "--content-type", "application/json", "--accept", "text/event-stream", "--payload", `fileb://${input}`, output], { stdio: "pipe", timeout: 90_000, windowsHide: true });
    const response = readFileSync(output, "utf8");
    const events = response.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } });
    const spoken = events.map((e) => (typeof e?.text === "string" ? e.text : "")).join("");
    const passed = spoken.trim().length > 0 && !/<\/?thinking>/i.test(spoken) && !/event:\s*error/.test(response) && !events.some((e) => e?.error || /link your PairUp account/i.test(e?.text ?? ""));
    entries.push({ check: "AgentCore invocation", passed, response });
  } catch { entries.push({ check: "AgentCore invocation", passed: false, response: "Invocation failed. Check AWS CLI credentials, runtime ARN, permissions and session logs locally; credentials are excluded from this report." }); }
  finally { for (const name of ['request.json', 'response.txt']) { const file = path.join(folder, name); if (existsSync(file)) unlinkSync(file); } rmdirSync(folder); }
}
const passed = entries.every((e) => e.passed);
const redact = (text: string) => token ? text.split(token).join("[REDACTED]") : text;
const fenced = (value: unknown) => "```json\n" + redact(JSON.stringify(value, null, 2)).replaceAll("```", "\\u0060\\u0060\\u0060") + "\n```";
writeFileSync(values.output!, `# PairUp runtime evidence\n\nRecorded ${new Date().toISOString()} against ${base.origin}. Local revision: ${revision}.\n\nOverall: **${passed ? "passed" : "incomplete"}**. ${arn ? "AgentCore was requested." : "AgentCore was not configured; collect it before claiming a deployed AgentCore run."}\n\n` + entries.map((e) => `## ${e.check}: ${e.passed ? "passed" : "failed"}\n\n${fenced(e.response)}\n`).join("\n") + "\nThis records actual responses. Local mock runs verify the collector and remain incomplete evidence for AWS. It does not establish Bee or Ring hardware provenance.\n");
console.log(`Wrote ${values.output}: ${passed ? "passed" : "incomplete"}`);
if (!passed) process.exitCode = 1;
