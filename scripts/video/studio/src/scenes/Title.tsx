import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Dots, Kicker } from "../components/base";
import { C, F } from "../lib/theme";
import { BAR, BEAT, clamp, cue, fb, pop, ramp, scene } from "../lib/time";

const S = scene("title").start;
const LETTERS = ["P", "A", "I", "R", "U", "P"];

/** The PairUp mark: two overlapping circles, drawn in the film's palette. */
export const Mark: React.FC<{ size: number; spin?: number }> = ({ size, spin = 0 }) => (
  <div style={{ position: "relative", width: size * 1.55, height: size, transform: `rotate(${spin}deg)` }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: size, height: size, borderRadius: "50%", background: C.cream }} />
    <div style={{ position: "absolute", left: size * 0.55, top: 0, width: size, height: size, borderRadius: "50%", background: C.ink, border: `${size * 0.09}px solid ${C.cream}`, boxSizing: "border-box" }} />
  </div>
);

export const Title: React.FC = () => {
  const f = useCurrentFrame();
  const brk = fb(10 - S), back = fb(10.5 - S);
  const inBreak = f >= brk && f < back;
  const collide = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const flash = interpolate(f, [0, 3, 10], [1, 0.9, 0], clamp);
  const markIn = pop(f, 6, 200, 12);
  const beatPunch = !inBreak ? Math.exp(-((f % BEAT) / 6)) : 0;
  const tagAt = cue("tagline", S);
  const tag = ramp(f, tagAt, 26);
  return (
    <AbsoluteFill>
      <Backdrop tone={inBreak ? "ink" : "rouge"} rays dots={false}>
        {/* The dots from the cold open collide into the mark. */}
        {f < 10 ? <Dots t={collide} size={150} gap={420} /> : null}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `scale(${1 + 0.018 * beatPunch})` }}>
          <div style={{ transform: `scale(${markIn}) translateY(${-30}px)`, marginBottom: 30 }}>
            <Mark size={130} spin={(1 - markIn) * -90} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {LETTERS.map((l, i) => {
              const at = i * BEAT;
              const p = pop(f, at, 380, 14, 0.6);
              const kick = i % 2 === 0 ? -1 : 1;
              const rot = f >= at ? kick * 6 * Math.exp(-((f - at) / 10)) * Math.cos((f - at) / 3) : 0;
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: F.display, fontSize: 330, lineHeight: 0.9, color: inBreak ? C.rouge : C.cream,
                    display: "inline-block", opacity: f >= at ? 1 : 0, transform: `translateY(${(1 - p) * -260}px) scale(${0.6 + 0.4 * p}) rotate(${rot}deg)`,
                    textShadow: inBreak ? "none" : "0 18px 0 rgba(120,10,0,0.35)",
                  }}
                >
                  {l}
                </span>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 18, fontFamily: F.serif, fontStyle: "italic", fontSize: 112, color: inBreak ? C.cream : C.ink,
              clipPath: `inset(0 ${100 - tag * 100}% 0 0)`, opacity: f >= tagAt ? 1 : 0,
            }}
          >
            Say it once.
          </div>
        </AbsoluteFill>
        {inBreak ? <Kicker color={C.gold} style={{ position: "absolute", bottom: 170, width: "100%", textAlign: "center" }}>Introducing</Kicker> : null}
      </Backdrop>
      <AbsoluteFill style={{ background: C.cream, opacity: flash, mixBlendMode: "screen" }} />
      <AbsoluteFill style={{ background: "#fff", opacity: interpolate(f, [brk, brk + 4], [0.6, 0], clamp) * (f >= brk ? 1 : 0) }} />
    </AbsoluteFill>
  );
};

export const TITLE_BARS = BAR;
