import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Dots, Label, Phone, Slam } from "../components/base";
import { Confetti } from "../components/Confetti";
import { Stamp } from "../components/product";
import { C, F } from "../lib/theme";
import { BEAT, clamp, cue, fb, glide, pop, ramp, scene } from "../lib/time";
import { ALEXA_LABEL } from "./Seller";

const S = scene("deal").start;

export const Deal: React.FC = () => {
  const f = useCurrentFrame();
  const yesMei = cue("yesMei", S); // the hit after Mei's "Yes!"
  const samLit = fb(34.5 - S);
  const yesSam = cue("yesSam", S);
  const deal = cue("deal", S);
  const outro = fb(37 - S);
  const apart = ramp(f, deal - 4, 14);
  const flashA = interpolate(f, [yesMei, yesMei + 8], [0.55, 0], clamp) * (f >= yesMei ? 1 : 0);
  const flashB = interpolate(f, [yesSam, yesSam + 8], [0.55, 0], clamp) * (f >= yesSam ? 1 : 0);
  const flashD = interpolate(f, [deal, deal + 10], [0.9, 0], clamp) * (f >= deal ? 1 : 0);
  const punch = f >= deal && f < outro ? Math.exp(-(((f - deal) % BEAT) / 6)) : 0;
  const mergeT = interpolate(f, [deal - 6, deal + 2], [0, 1], clamp);
  const settle = ramp(f, outro, 24);
  return (
    <AbsoluteFill>
      <Backdrop tone={f >= deal ? "rouge" : "velvet"} rays={f >= deal} dots={f < deal}>
        {/* Two phones face each other for the two beats. */}
        <div style={{ position: "absolute", inset: 0, perspective: 1600, opacity: 1 - apart }}>
          <Phone
            height={820}
            glow={C.gold}
            shots={[{ src: cap("mei_point"), from: 0 }, { src: cap("mei_confirmed"), from: yesMei }]}
            style={{ left: 330 - 400 * apart, top: 100, transform: `rotateY(14deg) scale(${1 + 0.04 * pop(f, 0) - 0.04 * pop(f, yesMei)})` }}
          />
          <Phone
            height={820}
            glow={C.rouge}
            shots={[{ src: cap("sam_listed"), from: 0 }, { src: cap("sam_agreed"), from: yesSam }]}
            style={{ left: 1200 + 400 * apart, top: 100, transform: `rotateY(-14deg) scale(${1 + 0.05 * pop(f, samLit) * (f < yesSam ? 1 : 0)})` }}
          />
          <Stamp at={yesMei} text="Yes" color={C.gold} size={130} rot={-10} style={{ left: 660, top: 140 }} />
          <Stamp at={yesSam} text="Agreed" color={C.rouge} size={110} rot={8} style={{ left: 930, top: 700 }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 470, textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: "0.3em", color: C.creamDim, opacity: ramp(f, 4, 10) }}>
            MEI · · · SAM
          </div>
        </div>
        {/* DEAL. */}
        {f >= deal - 6 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `scale(${1 + 0.02 * punch}) translateY(${-90 * settle}px)` }}>
            <div style={{ position: "relative", width: 1920, height: 240 }}>
              <Dots t={mergeT} size={200} y={120} gap={900} colors={[C.gold, C.cream]} />
            </div>
            <Slam at={deal} size={300} color={C.cream} style={{ textShadow: "0 16px 0 rgba(120,10,0,0.35)" }}>Deal.</Slam>
            <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 40, color: C.ink, letterSpacing: "0.08em", opacity: ramp(f, deal + 12, 12), marginTop: 8 }}>
              TI-84 · $18 · PAIRUP POINT, HUB NORTH ENTRANCE
            </div>
            <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 76, color: C.cream, marginTop: 34, opacity: settle }}>
              They pay each other at the hand-off.
            </div>
          </AbsoluteFill>
        ) : null}
        <Confetti at={deal} y={420} />
        {f < deal ? <Label text={ALEXA_LABEL} /> : null}
      </Backdrop>
      <AbsoluteFill style={{ background: C.gold, opacity: Math.max(flashA, flashB) * 0.5, mixBlendMode: "screen" }} />
      <AbsoluteFill style={{ background: "#fff", opacity: flashD }} />
    </AbsoluteFill>
  );
};

export const DEAL_GLIDE = glide;
