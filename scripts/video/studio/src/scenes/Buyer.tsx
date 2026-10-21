import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Label, Phone } from "../components/base";
import { Card, Spot, Stamp, Voice, Who } from "../components/product";
import { Quote } from "../components/Quote";
import { C, F } from "../lib/theme";
import { clamp, cue, fb, FPS, glide, pop, ramp, scene, VO } from "../lib/time";
import { ALEXA_LABEL, typingShots } from "./Seller";

const S = scene("buyer").start;

/** The pairing-core rule on a price rail: ask $20, budget $18, private minimum $15 → $18. */
const Rail: React.FC<{ at: number; slide: number; stamp: number }> = ({ at, slide, stamp }) => {
  const f = useCurrentFrame();
  const L = 120, R = 1120, lo = 12, hi = 22;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  const show = ramp(f, at, 20);
  const m = interpolate(f, [slide, slide + 30], [20, 18], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const flag = (v: number, label: string, sub: string, color: string, delay: number, up = true) => {
    const p = pop(f, at + delay, 260, 14);
    return (
      <div style={{ position: "absolute", left: x(v) - 3, top: up ? 0 : 150, width: 6, height: 150, background: color, opacity: f >= at + delay ? 1 : 0, transform: `scaleY(${p})`, transformOrigin: up ? "bottom" : "top" }}>
        <div style={{ position: "absolute", [up ? "bottom" : "top"]: 158, left: -160, width: 326, textAlign: "center" }}>
          <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, letterSpacing: "0.2em", color, textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontFamily: F.display, fontSize: 64, color: C.cream, lineHeight: 1 }}>{sub}</div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", left: 0, top: 360, width: 1240, height: 300, opacity: show, transform: `translateY(${(1 - show) * 60}px)` }}>
      <div style={{ position: "absolute", left: L, top: 147, width: R - L, height: 6, background: "rgba(247,235,217,0.35)", borderRadius: 3 }} />
      {Array.from({ length: hi - lo + 1 }, (_, i) => (
        <div key={i} style={{ position: "absolute", left: x(lo + i) - 1, top: 140, width: 2, height: 20, background: "rgba(247,235,217,0.35)" }} />
      ))}
      {flag(20, "Sam asks", "$20", C.cream, 0)}
      {flag(18, "Mei's budget", "$18", C.gold, 8, false)}
      {flag(15, "Sam's minimum · private", "$15", C.rouge, 16)}
      {/* The settled price marker. */}
      {f >= slide - 4 ? (
        <div style={{ position: "absolute", left: x(m) - 26, top: 124, width: 52, height: 52, transform: "rotate(45deg)", background: C.gold, boxShadow: `0 0 40px ${C.gold}` }} />
      ) : null}
      <div style={{ position: "absolute", left: L, top: 400, fontFamily: F.mono, fontSize: 34, color: C.cream, opacity: ramp(f, at + 24, 16) }}>
        <span style={{ color: C.creamDim }}>pairing-core ›</span> price = min(ask, buyer_max) = <span style={{ color: C.gold }}>min($20, $18)</span>
        <div style={{ marginTop: 10, opacity: ramp(f, slide + 20, 12) }}>
          <span style={{ color: C.creamDim }}>deal iff</span> price ≥ seller_min <span style={{ color: C.mint }}>✓</span>
        </div>
      </div>
      <Stamp at={stamp} text="$18 · settled" color={C.gold} size={96} rot={-6} style={{ left: 640, top: 210 }} />
    </div>
  );
};

export const Buyer: React.FC = () => {
  const f = useCurrentFrame();
  const mei = VO.find((l) => l.id === "mei1")!;
  const now = f / FPS + S * 1.6;
  const speaking = now >= mei.start && now <= mei.start + mei.duration;
  const enter = glide(f, 0);
  const matchAt = cue("match", S);
  const railAt = cue("rail", S);
  const card = pop(f, matchAt, 170, 15);
  const cardOut = ramp(f, railAt - 10, 16);
  const W = 700, scale = W / 1194;
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 78% 55%, ${C.gold}22, transparent 45%)` }} />
        <div style={{ position: "absolute", inset: 0, perspective: 1600 }}>
          <Phone
            height={840}
            glow={C.gold}
            shots={typingShots("mei", "mei1", S, [{ src: cap("mei_match"), from: matchAt }])}
            style={{ left: 1290, top: 110, transform: `translateX(${(1 - enter) * 900}px) rotateY(${-16}deg)` }}
          />
        </div>
        <div style={{ position: "absolute", left: 140, top: 170, opacity: 1 - card }}>
          <Who name="Mei" role="The buyer" color={C.gold} />
          <div style={{ marginTop: 26 }}><Voice on={speaking} color={C.gold} /></div>
          <div style={{ marginTop: 30 }}><Quote id="mei1" sceneStartBar={S} width={980} /></div>
        </div>
        {f >= matchAt && cardOut < 1 ? (
          <div style={{ position: "absolute", left: 300, top: 120, opacity: Math.min(1, card * 1.5) * (1 - cardOut), transform: `translateX(${(1 - card) * 500}px) scale(${0.6 + 0.4 * card}) translateY(${-200 * cardOut}px)` }}>
            <Card name="card_mei_match" width={W} natural={[1194, 1950]} crop={930}>
              <Spot at={matchAt + 20} x={52} y={340} w={240} h={110} scale={scale} />
              <Spot at={matchAt + 40} x={52} y={670} w={1080} h={140} scale={scale} color={C.cream} />
            </Card>
          </div>
        ) : null}
        <Rail at={railAt} slide={cue("slide", S)} stamp={cue("price18", S)} />
        <Label text={ALEXA_LABEL} />
        {f >= matchAt ? <Label text="Demo delivery quote — no carrier booking" x={64} y={110} delay={matchAt} /> : null}
      </Backdrop>
    </AbsoluteFill>
  );
};

export const BUYER_END = fb(8);
