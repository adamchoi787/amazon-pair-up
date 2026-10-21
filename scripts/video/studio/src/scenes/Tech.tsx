import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Kicker, Slam } from "../components/base";
import { Stamp } from "../components/product";
import tools from "../generated/tools.json";
import { C, F } from "../lib/theme";
import { BEAT, clamp, cue, fb, pop, ramp, scene } from "../lib/time";

const S = scene("tech").start;

const NODES = [
  { k: "Voice", t: "Alexa+", s: "simulated host · any MCP client" },
  { k: "Protocol", t: "MCP server", s: "2025-11-25 · OAuth 2.1 · MCP Apps" },
  { k: "Understand", t: "Bedrock Nova", s: "intent · tool use" },
  { k: "Retrieve", t: "Titan + pgvector", s: "hybrid with full-text search" },
  { k: "Settle", t: "pairing-core", s: "Rust → WebAssembly · cents" },
  { k: "Commit", t: "Postgres", s: "transactions · holds · schedules" },
  { k: "Consent", t: "Both say yes", s: "interactive MCP Apps card" },
];
const GAP = 470;

const Pipeline: React.FC<{ at: number[] }> = ({ at }) => {
  const f = useCurrentFrame();
  // Camera follows the newest lit node, keeping the earlier ones in view on the left.
  const lit = at.filter((a) => f >= a).length;
  const prev = Math.max(0, lit - 2), cur = Math.max(0, lit - 1);
  const cam = lit === 0 ? 0 : interpolate(f, [at[cur], at[cur] + 28], [prev, cur], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const camX = 1250 - 200 - cam * GAP;
  return (
    <div style={{ position: "absolute", left: camX, top: 330, height: 360 }}>
      <div style={{ position: "absolute", left: 200, top: 150, width: (NODES.length - 1) * GAP, height: 6, background: "rgba(247,235,217,0.15)" }} />
      <div style={{ position: "absolute", left: 200, top: 150, width: Math.max(0, lit - 1) * GAP, height: 6, background: C.gold, boxShadow: `0 0 20px ${C.gold}` }} />
      {NODES.map((n, i) => {
        const on = f >= at[i];
        const p = pop(f, at[i], 300, 14);
        const pulse = on ? Math.exp(-((f - at[i]) % BEAT) / 8) : 0;
        return (
          <div key={n.t} style={{ position: "absolute", left: i * GAP, top: 0, width: 400, height: 300 }}>
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 26, padding: "34px 34px", boxSizing: "border-box",
                background: on ? "rgba(10,14,60,0.92)" : "rgba(10,14,60,0.5)", border: `2px solid ${on ? C.gold : "rgba(247,235,217,0.15)"}`,
                boxShadow: on ? `0 0 ${40 + 30 * pulse}px rgba(255,194,61,${0.35 + 0.3 * pulse})` : "none", transform: `scale(${on ? 0.9 + 0.1 * p : 0.9})`,
              }}
            >
              <div style={{ fontFamily: F.mono, fontSize: 22, color: on ? C.gold : C.creamDim, letterSpacing: "0.1em" }}>{String(i + 1).padStart(2, "0")} · {n.k.toUpperCase()}</div>
              <div style={{ fontFamily: F.display, fontSize: 56, color: C.cream, textTransform: "uppercase", lineHeight: 1.05, marginTop: 16, whiteSpace: "nowrap" }}>{n.t}</div>
              <div style={{ fontFamily: F.sans, fontSize: 25, color: C.creamDim, marginTop: 10, lineHeight: 1.25 }}>{n.s}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const CODE = [
  "// pairing-core · MIT · Rust compiled to WebAssembly",
  "let s = settle(Limits {",
  "    ask: 2000, seller_min: 1500, buyer_max: 1800, floor: 0,",
  "});",
  "assert_eq!(s, Settlement::Deal { price: 1800, saved_vs_ask: 200 });",
];

const Code: React.FC<{ at: number; stamp: number; out: number }> = ({ at, stamp, out }) => {
  const f = useCurrentFrame();
  const total = CODE.join("\n").length;
  const shown = Math.floor(interpolate(f, [at, at + 130], [0, total], clamp));
  let left = shown;
  const o = ramp(f, at - 10, 12) * (1 - ramp(f, out, 14));
  return (
    <div style={{ position: "absolute", left: 170, top: 280, width: 1580, opacity: o, transform: `translateY(${(1 - ramp(f, at - 10, 16)) * 40}px)` }}>
      <div style={{ background: "rgba(4,6,30,0.92)", borderRadius: 24, padding: "40px 48px", border: "1.5px solid rgba(247,235,217,0.15)", boxShadow: "0 40px 120px rgba(0,0,0,0.5)" }}>
        {CODE.map((line, i) => {
          const n = Math.max(0, Math.min(line.length, left));
          left -= line.length + 1;
          return (
            <div key={i} style={{ fontFamily: F.mono, fontSize: 38, lineHeight: 1.55, color: i === 0 ? "rgba(247,235,217,0.5)" : C.cream, whiteSpace: "pre" }}>
              {line.slice(0, n)}
              {n > 0 && n < line.length ? <span style={{ background: C.gold, color: C.gold }}>_</span> : null}
            </div>
          );
        })}
        <div style={{ marginTop: 22, fontFamily: F.mono, fontSize: 29, color: C.gold, opacity: ramp(f, at + 120, 12) }}>price = min(ask, buyer_max) · deal iff price ≥ seller_min · integer cents</div>
      </div>
      <Stamp at={stamp} text="$18.00 · exact" color={C.gold} size={92} rot={-5} style={{ right: 40, top: -70 }} />
    </div>
  );
};

const EVIDENCE = [
  { big: "175/175", s: "tests passing" },
  { big: "CI ✓", s: "green on release v0.8.0" },
  { big: "9/9", s: "release checks on the live endpoint" },
  { big: "1024-D", s: "Titan Embeddings V2 · live call" },
  { big: "Nova ✓", s: "intent + tool selection · live call" },
  { big: "AWS", s: "CloudFront · EC2 Graviton · CloudWatch" },
];

const Wall: React.FC<{ at: number[] }> = ({ at }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 150, top: 250, width: 1620, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 30 }}>
      {EVIDENCE.map((e, i) => {
        const p = pop(f, at[i], 380, 14, 0.6);
        return (
          <div key={e.big} style={{ height: 250, borderRadius: 24, background: "rgba(10,14,60,0.9)", border: `2px solid ${C.gold}`, padding: "30px 36px", boxSizing: "border-box", opacity: f >= at[i] ? 1 : 0, transform: `scale(${1.6 - 0.6 * p}) rotate(${(1 - p) * (i % 2 ? 4 : -4)}deg)` }}>
            <div style={{ fontFamily: F.display, fontSize: 104, color: C.cream, lineHeight: 1 }}>{e.big}</div>
            <div style={{ fontFamily: F.sans, fontSize: 30, color: C.creamDim, marginTop: 14 }}>{e.s}</div>
          </div>
        );
      })}
      <div style={{ gridColumn: "1 / -1", fontFamily: F.mono, fontSize: 22, color: "rgba(247,235,217,0.55)", opacity: ramp(f, at[5] + 10, 10) }}>
        Recorded against the deployed release, Oct 20, 2026 · docs/EVIDENCE.md
      </div>
    </div>
  );
};

export const Tech: React.FC = () => {
  const f = useCurrentFrame();
  const nodes = [0, 1, 2, 3, 4, 5, 6].map((i) => cue(`node${i}`, S));
  const codeAt = cue("code", S);
  const ev = [0, 1, 2, 3, 4, 5].map((i) => cue(`ev${i}`, S));
  const glitch = f < 14 ? Math.sin(f * 3.1) * 14 * (1 - f / 14) : 0;
  const pipeOut = ramp(f, codeAt - 18, 14);
  const titleUp = ramp(f, nodes[0] - 20, 18);
  const punch = Math.exp(-((f % BEAT) / 6));
  const list = (tools as { name: string }[]).map((t) => t.name);
  return (
    <AbsoluteFill>
      <Backdrop tone="cobalt" dots>
        {/* The real MCP tool list, scrolling behind. */}
        <div style={{ position: "absolute", right: 60, top: -200 + ((f * 1.2) % 400) - 400, fontFamily: F.mono, fontSize: 30, lineHeight: 1.7, color: "rgba(247,235,217,0.09)", textAlign: "right" }}>
          {[...list, ...list, ...list].map((n, i) => <div key={i}>{n}()</div>)}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: interpolate(titleUp, [0, 1], [380, 110]), display: "flex", justifyContent: "center", transform: `scale(${interpolate(titleUp, [0, 1], [1, 0.45]) * (1 + 0.015 * punch)})`, transformOrigin: "center top" }}>
          <div style={{ position: "relative" }}>
            <Slam at={0} size={230} color={C.cream} style={{ textShadow: `${glitch}px 0 ${C.rouge}, ${-glitch}px 0 #5af` }}>Under the hood</Slam>
          </div>
        </div>
        <div style={{ opacity: (1 - pipeOut) * ramp(f, nodes[0] - 22, 16) }}>
          <Pipeline at={nodes} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 760, textAlign: "center", fontFamily: F.serif, fontStyle: "italic", fontSize: 54, color: C.cream, opacity: ramp(f, nodes[2], 14) }}>
            Agents interpret. Code sets the price and checks the schedule.
          </div>
        </div>
        <Code at={codeAt} stamp={cue("settle", S)} out={ev[0] - 16} />
        {f >= ev[0] - 4 ? <Wall at={ev} /> : null}
        <Kicker color={C.gold} style={{ position: "absolute", left: 64, top: 60 }}>{f < codeAt - 18 ? "Architecture" : f < ev[0] - 16 ? "The price rule, open source" : "Live on AWS"}</Kicker>
      </Backdrop>
    </AbsoluteFill>
  );
};

export const TECH_END = fb(16);
