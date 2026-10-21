import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Dots, Kicker, Slam } from "../components/base";
import { C, F } from "../lib/theme";
import { BEAT, clamp, cue, FPS, glide, pop, ramp, scene, VO } from "../lib/time";

const S = scene("what").start;

const CARDS = [
  { tag: "Item", kind: "a thing", quote: "Sell my TI-84.", bg: C.rouge, fg: C.cream, rot: -6, cue: "card1" },
  { tag: "Errand", kind: "a run", quote: "Bring my lunch to McCarty Hall.", bg: C.gold, fg: C.ink, rot: 3, cue: "card2" },
  { tag: "Job", kind: "a hand", quote: "Help at my event, Saturday.", bg: C.cream, fg: C.ink, rot: -2, cue: "card3" },
];

const wordAt = (id: string, word: string) => {
  const l = VO.find((x) => x.id === id)!;
  const w = l.words.find((x) => x.w.toLowerCase().startsWith(word.toLowerCase()));
  return Math.round((w ? w.t : l.start) * FPS) - Math.round(S * 1.6 * FPS);
};

export const What: React.FC = () => {
  const f = useCurrentFrame();
  const pinAt = cue("pin", S);
  const alexaAt = wordAt("n06", "Tell");
  const pairAt = wordAt("n06", "pair.");
  const shrink = glide(f, pinAt - 12);
  const cardsOut = ramp(f, alexaAt - 10, 16);
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        <Kicker style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", opacity: ramp(f, 4, 12) * (1 - cardsOut) }}>
          One sentence · things and services
        </Kicker>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - cardsOut }}>
          <div style={{ display: "flex", gap: 44, transform: `translateY(${-140 * shrink}px) scale(${1 - 0.28 * shrink})` }}>
            {CARDS.map((c, i) => {
              const at = cue(c.cue, S);
              const p = pop(f, at, 240, 14);
              const bob = Math.sin((f - at) / 9 + i) * 4;
              return (
                <div
                  key={c.tag}
                  style={{
                    width: 470, height: 520, borderRadius: 26, background: c.bg, color: c.fg, padding: "44px 40px", boxSizing: "border-box",
                    transform: `translateY(${(1 - p) * 700 + bob}px) rotate(${c.rot * p}deg)`, opacity: f >= at ? 1 : 0,
                    boxShadow: "0 40px 80px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontFamily: F.display, fontSize: 120, lineHeight: 0.9, textTransform: "uppercase" }}>{c.tag}</div>
                    <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 24, letterSpacing: "0.24em", textTransform: "uppercase", opacity: 0.7, marginTop: 10 }}>{c.kind}</div>
                  </div>
                  <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 58, lineHeight: 1.05 }}>“{c.quote}”</div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
        {/* The place: University of Washington, Seattle. */}
        {f >= pinAt ? (
          <div style={{ position: "absolute", left: 0, right: 0, top: 690, display: "flex", justifyContent: "center", opacity: 1 - cardsOut }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22, transform: `translateY(${(1 - pop(f, pinAt, 300, 12)) * -120}px)` }}>
              <svg width={64} height={84} viewBox="0 0 64 84">
                <path d="M32 82 C32 82 4 48 4 30 A28 28 0 1 1 60 30 C60 48 32 82 32 82 Z" fill={C.rouge} />
                <circle cx={32} cy={30} r={11} fill={C.cream} />
              </svg>
              <div style={{ fontFamily: F.display, fontSize: 92, color: C.cream, textTransform: "uppercase", lineHeight: 1 }}>UW · Seattle</div>
            </div>
          </div>
        ) : null}
        {/* "Tell Alexa+ once, and PairUp finds your pair." */}
        {f >= alexaAt - 10 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", height: 140, opacity: cardsOut }}>
              {Array.from({ length: 23 }, (_, i) => {
                const h = 20 + 100 * Math.abs(Math.sin(f / 4 + i * 0.7) * Math.sin(f / 11 + i * 0.3)) * (f < pairAt ? 1 : 0.15);
                return <div key={i} style={{ width: 12, height: h, borderRadius: 6, background: i % 2 ? C.cream : C.rouge }} />;
              })}
            </div>
            <Slam at={alexaAt} size={150} style={{ marginTop: 40 }}>Tell Alexa+ once.</Slam>
            <div style={{ position: "relative", width: 1920, height: 200, marginTop: 20 }}>
              {f >= pairAt - 18 ? <Dots t={interpolate(f, [pairAt - 18, pairAt], [0, 1], clamp)} size={110} y={100} gap={700} /> : null}
            </div>
          </AbsoluteFill>
        ) : null}
      </Backdrop>
    </AbsoluteFill>
  );
};

export const WHAT_BEAT = BEAT;
