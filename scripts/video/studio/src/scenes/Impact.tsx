import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Dots, Kicker, Slam } from "../components/base";
import { Stamp } from "../components/product";
import { C, F } from "../lib/theme";
import { BEAT, clamp, cue, fb, pop, ramp, scene } from "../lib/time";

const S = scene("impact").start;

const rand = (i: number, k: number) => {
  const x = Math.sin(i * 91.7 + k * 47.3) * 43758.5453;
  return x - Math.floor(x);
};

/** Agents converge in pairs on one meeting place; each pair ends in a human check. */
const Agents: React.FC<{ at: number; yes: number }> = ({ at, yes }) => {
  const f = useCurrentFrame();
  const pairs = 9;
  return (
    <AbsoluteFill>
      {Array.from({ length: pairs }, (_, i) => {
        const ang = (i / pairs) * Math.PI * 2 + 0.3;
        const r0 = 1000, r1 = 560 + 60 * rand(i, 1);
        const t = interpolate(f, [at + i * 4, at + 60 + i * 4], [0, 1], { ...clamp, easing: (u) => 1 - Math.pow(1 - u, 3) });
        const r = r0 + (r1 - r0) * t;
        const cx = 960 + Math.cos(ang) * r * 1.05, cy = 540 + Math.sin(ang) * r * 0.66;
        const meet = interpolate(f, [at + 70 + i * 3, at + 90 + i * 3], [0, 1], clamp);
        const ok = f >= yes + i * 3;
        return (
          <div key={i} style={{ position: "absolute", left: cx, top: cy }}>
            <Dots t={meet} size={46} x={0} y={0} gap={110} glow={false} colors={[C.rouge, C.cream]} />
            {ok ? (
              <div style={{ position: "absolute", left: -18, top: -70, width: 36, height: 36, borderRadius: "50%", background: C.mint, color: C.ink, fontFamily: F.sans, fontWeight: 700, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${pop(f, yes + i * 3, 400, 12)})` }}>✓</div>
            ) : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Impact: React.FC = () => {
  const f = useCurrentFrame();
  const fees = cue("fees", S), strike = cue("strike", S), keep = cue("keep100", S);
  const earners = cue("earners", S), bubble = cue("bubble", S), agents = cue("agents", S), yes = cue("humanYes", S);
  const part = f < earners - 8 ? 0 : f < agents - 30 ? 1 : 2;
  const count = interpolate(f, [earners, earners + 50], [0, 72.9], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const strikeW = ramp(f, strike, 10);
  const punch = Math.exp(-((f % BEAT) / 6));
  const markIn = pop(f, agents + 60, 200, 14);
  return (
    <AbsoluteFill>
      <Backdrop tone={part === 0 ? "cream" : part === 1 ? "rouge" : "ink"} rays={part !== 2} dots>
        {part === 0 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `scale(${1 + 0.012 * punch})` }}>
            <Kicker color={C.rougeDeep} style={{ opacity: ramp(f, fees, 10) }}>Resale sites keep</Kicker>
            <div style={{ position: "relative" }}>
              <Slam at={fees} size={330} color={C.ink}>13–20%</Slam>
              <div style={{ position: "absolute", left: -20, top: 150, height: 26, width: `${strikeW * 105}%`, background: C.rouge, transform: "rotate(-6deg)", borderRadius: 13 }} />
            </div>
            <Stamp at={keep} text="100% to the seller" color={C.rouge} size={120} rot={-6} style={{ position: "relative", marginTop: 10 }} />
          </AbsoluteFill>
        ) : null}
        {part === 1 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 90, transform: `translateY(${-110 * ramp(f, bubble - 6, 16)}px)` }}>
              <div>
                <div style={{ fontFamily: F.display, fontSize: 300, color: C.cream, lineHeight: 0.9, textShadow: "0 16px 0 rgba(120,10,0,0.35)" }}>{count.toFixed(1)}M</div>
                <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 30, color: C.ink, letterSpacing: "0.08em", marginTop: 10 }}>AMERICANS EARN INDEPENDENTLY · MBO PARTNERS 2025</div>
              </div>
            </div>
            {f >= bubble ? (
              <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 20, transform: `scale(${pop(f, bubble, 260, 14)})` }}>
                <div style={{ background: C.cream, color: C.ink, borderRadius: 40, borderBottomLeftRadius: 8, padding: "26px 44px", fontFamily: F.serif, fontStyle: "italic", fontSize: 64 }}>“I can do lunch runs for $4.”</div>
                <div style={{ fontFamily: F.display, fontSize: 96, color: C.cream, textTransform: "uppercase" }}>= a business.</div>
              </div>
            ) : null}
          </AbsoluteFill>
        ) : null}
        {part === 2 ? (
          <>
            <Agents at={agents - 30} yes={yes} />
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
              <div style={{ transform: `scale(${markIn})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ position: "relative", width: 300, height: 190 }}><Dots t={1} size={150} x={150} y={95} glow /></div>
                <div style={{ fontFamily: F.display, fontSize: 100, color: C.cream, textTransform: "uppercase", marginTop: 10 }}>A fair place to meet</div>
                <div style={{ fontFamily: F.sans, fontSize: 32, color: C.creamDim, marginTop: 10 }}>An open rule sets the price · a human says yes</div>
              </div>
            </AbsoluteFill>
            <Kicker style={{ position: "absolute", left: 64, top: 60 }}>Personal agents, shopping for people</Kicker>
          </>
        ) : null}
      </Backdrop>
    </AbsoluteFill>
  );
};

export const IMPACT_END = fb(12);
