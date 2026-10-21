import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Dots, Kicker } from "../components/base";
import { Confetti } from "../components/Confetti";
import { C, F } from "../lib/theme";
import { BEAT, clamp, cue, fb, glide, pop, ramp, scene, TOTAL } from "../lib/time";
import { Mark } from "./Title";

const S = scene("finale").start;
const LETTERS = ["P", "A", "I", "R", "U", "P"];

const Repo: React.FC<{ at: number; name: string; lines: string[]; x: number; y: number; accent: string }> = ({ at, name, lines, x, y, accent }) => {
  const f = useCurrentFrame();
  const p = glide(f, at);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 800, transform: `translateY(${(1 - p) * 300}px)`, opacity: p }}>
      <div style={{ background: "rgba(13,10,11,0.85)", border: `2px solid ${accent}`, borderRadius: 24, padding: "34px 40px", boxShadow: "0 40px 100px rgba(0,0,0,0.5)" }}>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.creamDim }}>github.com/</div>
        <div style={{ fontFamily: F.display, fontSize: 62, color: C.cream, lineHeight: 1.05, whiteSpace: "nowrap" }}>{name}</div>
        {lines.map((l, i) => (
          <div key={l} style={{ fontFamily: F.sans, fontSize: 30, color: C.cream, marginTop: 14, opacity: ramp(f, at + 14 + i * 8, 10) }}>
            <span style={{ color: accent }}>●</span> {l}
          </div>
        ))}
      </div>
    </div>
  );
};

export const Finale: React.FC = () => {
  const f = useCurrentFrame();
  const gap = fb(99.5 - S), drop = fb(100 - S), endcard = cue("endcard", S), hits = fb(104 - S), finalHit = cue("final", S);
  const pilot = cue("pilot", S);
  const inGap = f >= gap && f < drop;
  const kick = (i: number) => {
    if (f < drop || f >= hits + BEAT) return { rot: 0, y: 0 };
    const beat = Math.floor((f - drop) / BEAT);
    const ph = ((f - drop) % BEAT) / BEAT;
    const lift = Math.exp(-ph * 4);
    const side = (beat + i) % 2 === 0 ? 1 : -1;
    return { rot: side * 7 * lift, y: -28 * lift * ((beat + i) % 2) };
  };
  const finalP = f >= finalHit ? pop(f, finalHit, 300, 12) : 0;
  const hitFlash = [hits, hits + 12, hits + 24, finalHit].reduce((m, h) => Math.max(m, f >= h ? interpolate(f, [h, h + 8], [0.5, 0], clamp) : 0), 0);
  const fadeOut = interpolate(f, [TOTAL - fb(S) - 40, TOTAL - fb(S) - 2], [0, 1], clamp);
  const tagPulse = f >= fb(104.4 - S) ? 1 + 0.08 * Math.exp(-(f - fb(104.4 - S)) / 10) : 1;
  return (
    <AbsoluteFill>
      {f < gap ? (
        <Backdrop tone="velvet">
          <Kicker style={{ position: "absolute", left: 120, top: 120 }}>Open source · MIT</Kicker>
          <Repo at={4} name="rairurairu/pairing-core" accent={C.gold} x={120} y={190} lines={["Rust compiled to WebAssembly", "settle(): one fixed rule, integer cents", "Invariant tests + shared test vectors"]} />
          <Repo at={24} name="rairurairu/amazon-pair-up" accent={C.rouge} x={1000} y={330} lines={["MCP server, web app, MCP Apps cards", "175 tests · release v0.8.0"]} />
          {f >= pilot ? (
            <div style={{ position: "absolute", left: 1000, top: 800, display: "flex", alignItems: "center", gap: 20, transform: `translateY(${(1 - pop(f, pilot, 300, 12)) * -160}px)` }}>
              <svg width={56} height={74} viewBox="0 0 64 84"><path d="M32 82 C32 82 4 48 4 30 A28 28 0 1 1 60 30 C60 48 32 82 32 82 Z" fill={C.gold} /><circle cx={32} cy={30} r={11} fill={C.ink} /></svg>
              <div style={{ fontFamily: F.display, fontSize: 80, color: C.cream, textTransform: "uppercase" }}>Next: a UW pilot</div>
            </div>
          ) : null}
        </Backdrop>
      ) : null}
      {inGap ? (
        <AbsoluteFill style={{ background: C.ink }}>
          <Dots t={interpolate(f, [gap, drop], [0, 0.75], clamp)} size={130} gap={760} />
        </AbsoluteFill>
      ) : null}
      {f >= drop ? (
        <Backdrop tone="rouge" rays dots={false}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `translateY(${-70 * ramp(f, endcard, 30)}px) scale(${1 + 0.03 * finalP * Math.exp(-(f - finalHit) / 12)})` }}>
            <div style={{ transform: `scale(${pop(f, drop, 220, 11)}) rotate(${(1 - pop(f, drop, 220, 11)) * -120}deg)`, marginBottom: 70 }}>
              <Mark size={120} />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {LETTERS.map((l, i) => {
                const k = kick(i);
                const p = pop(f, drop + i * 3, 380, 14, 0.6);
                return (
                  <span key={i} style={{ fontFamily: F.display, fontSize: 340, lineHeight: 0.9, color: C.cream, display: "inline-block", transform: `translateY(${(1 - p) * -300 + k.y}px) rotate(${k.rot}deg)`, textShadow: "0 18px 0 rgba(120,10,0,0.35)" }}>
                    {l}
                  </span>
                );
              })}
            </div>
            <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 120, color: C.ink, marginTop: 10, clipPath: `inset(0 ${100 - ramp(f, drop + 30, 30) * 100}% 0 0)`, transform: `scale(${tagPulse})` }}>
              Say it once.
            </div>
            <div style={{ marginTop: 34, display: "flex", gap: 18, opacity: ramp(f, endcard, 20) }}>
              {["Alexa+", "Ring", "Bee", "AWS", "Open source"].map((t) => (
                <div key={t} style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 26, letterSpacing: "0.16em", textTransform: "uppercase", color: C.cream, border: `2px solid ${C.cream}`, borderRadius: 99, padding: "10px 24px" }}>{t}</div>
              ))}
            </div>
            <div style={{ marginTop: 26, fontFamily: F.mono, fontSize: 30, color: C.ink, opacity: ramp(f, endcard + 20, 20) }}>github.com/rairurairu/amazon-pair-up</div>
          </AbsoluteFill>
          <Confetti at={drop} y={300} count={160} power={1.2} />
          <Confetti at={finalHit} y={360} count={120} />
        </Backdrop>
      ) : null}
      <AbsoluteFill style={{ background: "#fff", opacity: f >= drop ? Math.max(interpolate(f, [drop, drop + 10], [0.9, 0], clamp), hitFlash) : 0 }} />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
