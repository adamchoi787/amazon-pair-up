import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Label, Phone } from "../components/base";
import { Card, Spot, Stamp, Voice, Who } from "../components/product";
import { Quote } from "../components/Quote";
import { C, F } from "../lib/theme";
import { clamp, cue, fb, FPS, glide, pop, ramp, scene, VO } from "../lib/time";

const S = scene("seller").start;
export const ALEXA_LABEL = "Simulated Alexa+ experience · Demo market";

/** Typing frames spread across a spoken line, then the sent state. */
export const typingShots = (prefix: string, lineId: string, sceneStart: number, after: { src: string; from: number }[]) => {
  const l = VO.find((x) => x.id === lineId)!;
  const a = Math.round((l.start - sceneStart * 1.6) * FPS);
  const d = Math.round(l.duration * FPS);
  const n = 10;
  return [
    { src: cap(`${prefix}_home`), from: 0 },
    ...Array.from({ length: n }, (_, i) => ({ src: cap(`${prefix}_type${String(i + 1).padStart(2, "0")}`), from: a + Math.round((d * (i + 0.5)) / n) })),
    ...after,
  ];
};

export const Seller: React.FC = () => {
  const f = useCurrentFrame();
  const sam = VO.find((l) => l.id === "sam1")!;
  const speaking = f / FPS + S * 1.6 >= sam.start && f / FPS + S * 1.6 <= sam.start + sam.duration;
  const enter = glide(f, 0);
  const cardAt = cue("cardSam", S);
  const lockAt = cue("lock", S);
  const card = pop(f, cardAt, 160, 15);
  const W = 820;
  const scale = W / 1194;
  const out = ramp(f, fb(5.75), 20);
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, background: `radial-gradient(circle at 26% 55%, ${C.rouge}33, transparent 45%)` }} />
        <div style={{ position: "absolute", inset: 0, perspective: 1600 }}>
          <Phone
            height={840}
            glow={C.rouge}
            shots={typingShots("sam", "sam1", S, [{ src: cap("sam_listed"), from: cue("replySam", S) }])}
            style={{ left: 200, top: 110, transform: `translateX(${(1 - enter) * -900}px) rotateY(${16 - 6 * ramp(f, cardAt, 40)}deg) translateX(${-60 * out}px)` }}
          />
        </div>
        {/* Right: who is speaking, then the real listing card with the private minimum. */}
        <div style={{ position: "absolute", left: 860, top: 150, opacity: 1 - card }}>
          <Who name="Sam" role="The seller" />
          <div style={{ marginTop: 26 }}><Voice on={speaking} /></div>
          <div style={{ marginTop: 30 }}><Quote id="sam1" sceneStartBar={S} accent={C.rouge} /></div>
        </div>
        {f >= cardAt ? (
          <div style={{ position: "absolute", left: 900, top: 250, transform: `translateX(${(1 - card) * -380}px) scale(${0.5 + 0.5 * card}) rotate(${(1 - card) * 8}deg)`, transformOrigin: "left center", opacity: Math.min(1, card * 1.5) }}>
            <Card name="card_sam_listing" width={W} natural={[1194, 807]}>
              <Spot at={lockAt} x={52} y={505} w={1010} h={90} scale={scale} color={C.rouge} />
            </Card>
            <Stamp at={lockAt + 4} text="Private" size={120} rot={-9} style={{ left: 420, top: 420, background: "rgba(13,10,11,0.35)" }} />
            {f >= lockAt ? (
              <svg width={120} height={140} viewBox="0 0 120 140" style={{ position: "absolute", left: -70, top: 330, transform: `scale(${pop(f, lockAt, 400, 12)})` }}>
                <path d={`M30 62 V44 a30 30 0 0 1 60 0 V${62 - 14 * (1 - ramp(f, lockAt, 8))}`} fill="none" stroke={C.gold} strokeWidth={12} strokeLinecap="round" />
                <rect x={16} y={60} width={88} height={70} rx={14} fill={C.gold} />
                <circle cx={60} cy={92} r={10} fill={C.ink} />
              </svg>
            ) : null}
          </div>
        ) : null}
        <Label text={ALEXA_LABEL} x={1270} />
      </Backdrop>
      <AbsoluteFill style={{ background: C.ink, opacity: interpolate(f, [0, 4], [0, 0], clamp) }} />
    </AbsoluteFill>
  );
};
