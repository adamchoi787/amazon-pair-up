import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Dots, Kicker, Slam } from "../components/base";
import { C, F } from "../lib/theme";
import { BAR, BEAT, clamp, cue, FPS, glide, pop, ramp, scene, VO } from "../lib/time";

const S = scene("cold").start;

const Bubble: React.FC<{ at: number; text: string; me?: boolean; y: number }> = ({ at, text, me, y }) => {
  const f = useCurrentFrame();
  const p = pop(f, at, 260, 15);
  if (f < at) return null;
  return (
    <div
      style={{
        position: "absolute", top: y, [me ? "right" : "left"]: 40, maxWidth: 520, padding: "18px 26px", borderRadius: 28,
        borderBottomRightRadius: me ? 6 : 28, borderBottomLeftRadius: me ? 28 : 6,
        background: me ? C.rouge : "#2b2326", color: C.cream, fontFamily: F.sans, fontSize: 34, fontWeight: 500,
        transform: `scale(${0.6 + 0.4 * p}) translateY(${(1 - p) * 30}px)`, transformOrigin: me ? "right bottom" : "left bottom", opacity: Math.min(1, p * 2),
      }}
    >
      {text}
    </div>
  );
};

/** Night map of the UW campus, drawn as a light street grid. */
const NightMap: React.FC<{ o: number }> = ({ o }) => {
  const f = useCurrentFrame();
  const lines = [];
  for (let i = 0; i < 26; i++) lines.push(<line key={`h${i}`} x1={-200} y1={i * 60 + ((i * 37) % 23)} x2={2200} y2={i * 60 - 140 + ((i * 53) % 31)} stroke={C.cream} strokeWidth={i % 5 === 0 ? 3 : 1} />);
  for (let i = 0; i < 34; i++) lines.push(<line key={`v${i}`} x1={i * 70 + ((i * 29) % 19)} y1={-200} x2={i * 70 - 120} y2={1300} stroke={C.cream} strokeWidth={i % 6 === 0 ? 3 : 1} />);
  return (
    <AbsoluteFill style={{ opacity: o, transform: `scale(${1.15 - 0.08 * ramp(f, cue("map", S), BAR * 3)}) rotate(-4deg)` }}>
      <svg width={1920} height={1080} style={{ opacity: 0.12 }}>{lines}</svg>
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: 0.22 }}>
        <path d="M 1300 120 C 1500 300, 1650 500, 1720 980" stroke={C.cream} strokeWidth={26} fill="none" opacity={0.25} />
        <ellipse cx={420} cy={860} rx={360} ry={150} fill="#22323a" opacity={0.9} />
      </svg>
    </AbsoluteFill>
  );
};

export const Cold: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const clockIn = pop(f, cue("clock", S), 160, 16);
  const mapIn = ramp(f, cue("map", S), 30);
  const sayAt = Math.round((VO.find((l) => l.id === "n03")!.words.find((w) => w.w.startsWith("say"))!.t) * FPS);
  const whatAt = Math.round(VO.find((l) => l.id === "n03")!.start * FPS);
  const dim = ramp(f, whatAt - 6, 18);
  const blink = Math.floor(f / BEAT) % 2 === 0 ? 1 : 0.25;
  const youAt = cue("dotYou", S), calcAt = cue("dotCalc", S), distAt = cue("distance", S);
  const ux = 760, uy = 610, cx = 1180, cy = 470;
  const pulse = (start: number) => (f < start ? 0 : ((f - start) % 48) / 48);
  return (
    <AbsoluteFill style={{ background: C.ink, transform: `scale(${1 + 0.05 * (f / (BAR * 8))})` }}>
      <Backdrop tone="ink" dots>
        <NightMap o={mapIn * (1 - 0.7 * dim)} />
        {/* Clock: big at first, then a corner badge once the map opens. */}
        <div
          style={{
            position: "absolute", left: interpolate(mapIn, [0, 1], [180, 70]), top: interpolate(mapIn, [0, 1], [300, 60]),
            transform: `scale(${interpolate(mapIn, [0, 1], [1, 0.36]) * (0.7 + 0.3 * clockIn)})`, transformOrigin: "left top",
            opacity: clockIn * (1 - 0.6 * dim), fontFamily: F.display, color: C.cream, fontSize: 300, lineHeight: 1, display: "flex", alignItems: "baseline", gap: 30,
          }}
        >
          <span>11</span><span style={{ opacity: blink, color: C.rouge }}>:</span><span>47</span>
          <span style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 90, color: C.rouge }}>PM</span>
        </div>
        <div style={{ position: "absolute", left: 186, top: 640, opacity: clockIn * (1 - mapIn), fontFamily: F.serif, fontStyle: "italic", fontSize: 64, color: C.creamDim }}>
          Exam at 9:00 AM.
        </div>
        {/* Group chat, the old way. */}
        <div style={{ position: "absolute", right: 120, top: 190, width: 640, height: 600, opacity: 1 - mapIn }}>
          <Kicker color={C.creamDim} style={{ fontSize: 20, marginLeft: 40 }}>Dorm group chat</Kicker>
          <Bubble at={cue("chat1", S)} text="anyone have a TI-84??" y={70} />
          <Bubble at={cue("chat2", S)} text="need it for my 9am exam" y={180} />
          <Bubble at={cue("chat3", S)} text="please, will pay" y={290} />
          {f >= cue("seen", S) ? (
            <div style={{ position: "absolute", left: 46, top: 395, fontFamily: F.sans, fontSize: 26, color: C.creamDim, opacity: ramp(f, cue("seen", S), 8) }}>Seen by 43 · no replies</div>
          ) : null}
        </div>
        {/* Two dots on the night map. */}
        {f >= youAt ? (
          <>
            <svg width={1920} height={1080} style={{ position: "absolute", opacity: (1 - dim * 0.5) }}>
              {f >= distAt ? (
                <line x1={ux} y1={uy} x2={ux + (cx - ux) * ramp(f, distAt, 20)} y2={uy + (cy - uy) * ramp(f, distAt, 20)} stroke={C.cream} strokeWidth={4} strokeDasharray="14 14" />
              ) : null}
              {[youAt, calcAt].map((s, i) => (
                <circle key={i} cx={i ? cx : ux} cy={i ? cy : uy} r={30 + 90 * pulse(s)} fill="none" stroke={i ? C.cream : C.rouge} strokeWidth={3} opacity={f >= s ? 1 - pulse(s) : 0} />
              ))}
            </svg>
            <div style={{ position: "absolute", left: ux - 26, top: uy - 26, width: 52, height: 52, borderRadius: 99, background: C.rouge, transform: `scale(${pop(f, youAt)})`, boxShadow: `0 0 60px ${C.rouge}` }} />
            <div style={{ position: "absolute", left: ux - 150, top: uy + 46, width: 300, textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 26, color: C.cream, letterSpacing: "0.12em", opacity: pop(f, youAt) * (1 - dim) }}>
              YOU · MCCARTY HALL
            </div>
            {f >= calcAt ? (
              <>
                <div style={{ position: "absolute", left: cx - 26, top: cy - 26, width: 52, height: 52, borderRadius: 99, background: C.cream, transform: `scale(${pop(f, calcAt)})`, boxShadow: `0 0 60px ${C.cream}` }} />
                <div style={{ position: "absolute", left: cx - 160, top: cy - 100, width: 320, textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 26, color: C.cream, letterSpacing: "0.12em", opacity: pop(f, calcAt) * (1 - dim) }}>
                  A TI-84 · NEXT DORM
                </div>
              </>
            ) : null}
            {f >= distAt ? (
              <div style={{ position: "absolute", left: (ux + cx) / 2 - 80, top: (uy + cy) / 2 + 14, width: 160, textAlign: "center", fontFamily: F.display, fontSize: 54, color: C.gold, opacity: ramp(f, distAt + 10, 12) * (1 - dim) }}>
                200 M
              </div>
            ) : null}
          </>
        ) : null}
        {/* "What if you could just… say it?" */}
        {f >= whatAt ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 92, color: C.cream, opacity: ramp(f, whatAt, 14) * (f >= sayAt ? 0.55 : 1) }}>What if you could just…</div>
            <Slam at={sayAt} size={240} color={C.rouge}>say it?</Slam>
          </AbsoluteFill>
        ) : null}
      </Backdrop>
      <AbsoluteFill style={{ background: "#000", opacity: interpolate(t, [0, 0.5], [1, 0], clamp) }} />
    </AbsoluteFill>
  );
};

/** Exposed so the title can start the dots where the cold open left them. */
export const ColdDots = Dots;
