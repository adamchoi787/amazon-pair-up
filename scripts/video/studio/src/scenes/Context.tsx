import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Kicker, Label } from "../components/base";
import { C, F } from "../lib/theme";
import { clamp, cue, fb, glide, pop, ramp, scene } from "../lib/time";

const S = scene("context").start;

/** Three weeks of weekday lunch runs lighting up, day by day. */
const Weeks: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const f = useCurrentFrame();
  const days = ["M", "T", "W", "T", "F"];
  return (
    <div style={{ position: "absolute", left: 130, top: 300, opacity: 1 - out, transform: `translateX(${-200 * out}px)` }}>
      <Kicker>Three weeks · Tony's own requests</Kicker>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 120px)", gap: 18, marginTop: 30 }}>
        {days.map((d, i) => <div key={i} style={{ textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 24, color: C.creamDim }}>{d}</div>)}
        {Array.from({ length: 15 }, (_, i) => {
          const on = at + i * 9;
          const p = pop(f, on, 320, 13);
          return (
            <div key={i} style={{ height: 96, borderRadius: 18, border: `2px solid rgba(247,235,217,0.18)`, display: "flex", alignItems: "center", justifyContent: "center", background: f >= on ? `rgba(255,194,61,${0.18 * p})` : "transparent" }}>
              {f >= on ? <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.gold, transform: `scale(${p})`, boxShadow: `0 0 24px ${C.gold}` }} /> : null}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 26, fontFamily: F.serif, fontStyle: "italic", fontSize: 50, color: C.cream, opacity: ramp(f, at + 140, 14) }}>the HUB → McCarty Hall, around 12:15</div>
    </div>
  );
};

/** The labelled Bee-format note: a conversation summary from the fixture. */
const BeeNote: React.FC<{ at: number; fold: number }> = ({ at, fold }) => {
  const f = useCurrentFrame();
  const p = pop(f, at, 220, 15);
  const fp = ramp(f, fold, 16);
  if (f < at || fp >= 1) return null;
  return (
    <div style={{ position: "absolute", left: 140, top: 250, width: 900, transform: `translateY(${(1 - p) * 200}px) scaleY(${1 - fp}) scaleX(${1 - 0.3 * fp})`, transformOrigin: "center bottom", opacity: Math.min(1, p * 2) }}>
      <div style={{ background: C.cream, borderRadius: 26, padding: "36px 40px", boxShadow: "0 40px 100px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.gold, border: `5px solid ${C.ink}` }} />
          <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: "0.22em", color: C.ink }}>BEE · CONVERSATION SUMMARY</div>
        </div>
        <div style={{ marginTop: 22, fontFamily: F.serif, fontStyle: "italic", fontSize: 64, lineHeight: 1.1, color: C.ink }}>
          “Realized my calculator broke; need a graphing calculator before the stats exam on Friday.”
        </div>
      </div>
    </div>
  );
};

export const Context: React.FC = () => {
  const f = useCurrentFrame();
  const forYou = cue("forYou", S);
  const bee = cue("beeNote", S);
  const fold = cue("fold", S);
  const watch = cue("watch", S);
  const tap = cue("watchYes", S);
  const dockA = glide(f, forYou);
  const dockAOut = ramp(f, bee - 10, 14);
  const dockB = glide(f, fold + 6);
  const watchIn = glide(f, watch);
  const tapT = f - tap;
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 70% 50%, ${C.gold}1c, transparent 45%)` }} />
        <Weeks at={cue("day0", S)} out={ramp(f, bee - 14, 16)} />
        {/* The routine, offered before noon (real dock capture). */}
        {f >= forYou ? (
          <div style={{ position: "absolute", left: 960, top: 360, width: 820, transform: `translateY(${(1 - dockA) * 500}px) translateX(${dockAOut * 600}px)`, opacity: 1 - dockAOut }}>
            <Kicker style={{ marginBottom: 20 }}>11:38 AM · For you</Kicker>
            <Img src={cap("dock_2")} style={{ width: 820, borderRadius: 24, boxShadow: "0 40px 100px rgba(0,0,0,0.55)" }} />
          </div>
        ) : null}
        <BeeNote at={bee} fold={fold} />
        {/* The note becomes a ready request in the dock, then on the watch. */}
        {f >= fold + 6 ? (
          <div style={{ position: "absolute", left: 140, top: 330, width: 760, transform: `translateY(${(1 - dockB) * 300}px) scale(${0.85 + 0.15 * dockB})`, opacity: dockB }}>
            <Img src={cap("dock_1")} style={{ width: 760, borderRadius: 24, boxShadow: "0 40px 100px rgba(0,0,0,0.55)" }} />
          </div>
        ) : null}
        {f >= watch ? (
          <div style={{ position: "absolute", left: 1180, top: 250, transform: `translateY(${(1 - watchIn) * 700}px) rotate(${(1 - watchIn) * 10}deg)` }}>
            <div style={{ position: "absolute", left: 120, top: -150, width: 180, height: 900, borderRadius: 40, background: "linear-gradient(90deg,#2a2226,#3b3034,#2a2226)" }} />
            <div style={{ position: "relative", width: 420, height: 516, borderRadius: 110, background: "#0b0a0b", border: "16px solid #3d3438", boxShadow: "0 50px 140px rgba(0,0,0,0.7)", overflow: "hidden" }}>
              <Img src={cap("watch_tony_suggestion")} style={{ width: "100%" }} />
              {tapT >= 0 && tapT < 40 ? (
                <div style={{ position: "absolute", left: 210 - tapT * 3, top: 420 - tapT * 3, width: tapT * 6, height: tapT * 6, borderRadius: "50%", border: `4px solid ${C.gold}`, opacity: 1 - tapT / 40 }} />
              ) : null}
            </div>
            <div style={{ position: "absolute", left: 470, top: 180, width: 260, fontFamily: F.serif, fontStyle: "italic", fontSize: 46, color: C.cream, opacity: ramp(f, watch + 20, 14) }}>waits for your yes</div>
          </div>
        ) : null}
        <Label text="Demo market · clock set to 11:38 AM PT" />
        {f >= bee ? <Label text="Synthetic Bee-format fixture · watch preview" y={110} delay={bee} /> : null}
      </Backdrop>
    </AbsoluteFill>
  );
};

export const CONTEXT_END = fb(8);
export const CONTEXT_CLAMP = clamp;
export const CONTEXT_I = interpolate;
