import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Kicker, Label, Slam } from "../components/base";
import { C, F } from "../lib/theme";
import { clamp, cue, fb, glide, pop, ramp, scene } from "../lib/time";

const S = scene("ring").start;

/** A window onto the Ring section of the real deal card (capture pixels y0..y1). */
const CardWindow: React.FC<{ name: string; y0: number; y1: number; width: number; style?: React.CSSProperties }> = ({ name, y0, y1, width, style }) => {
  const k = width / 1194;
  return (
    <div style={{ position: "absolute", width, height: (y1 - y0) * k, overflow: "hidden", borderRadius: 26, boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(247,235,217,0.12)", background: "#16151c", ...style }}>
      <Img src={cap(name)} style={{ position: "absolute", width, top: -y0 * k }} />
    </div>
  );
};

/** A doorbell at the PairUp Point, in the film's line-art style. */
const Doorbell: React.FC<{ presses: number[] }> = ({ presses }) => {
  const f = useCurrentFrame();
  const last = [...presses].reverse().find((p) => f >= p);
  const down = last !== undefined && f - last < 6 ? 0.9 : 1;
  return (
    <div style={{ position: "absolute", left: 300, top: 250, width: 240, height: 440 }}>
      {presses.map((p, i) =>
        f >= p ? (
          [0, 10, 20].map((d) => {
            const t = f - p - d;
            if (t < 0 || t > 60) return null;
            const r = 80 + t * 9;
            return <div key={`${i}-${d}`} style={{ position: "absolute", left: 120 - r, top: 290 - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `4px solid ${C.gold}`, opacity: 1 - t / 60 }} />;
          })
        ) : null,
      )}
      <div style={{ position: "absolute", inset: 0, borderRadius: 60, border: `6px solid ${C.cream}`, background: "linear-gradient(180deg,#2a2226,#141012)", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }} />
      <div style={{ position: "absolute", left: 96, top: 70, width: 48, height: 48, borderRadius: "50%", background: "#0b0809", border: `4px solid ${C.creamDim}` }} />
      <div
        style={{
          position: "absolute", left: 50, top: 220, width: 140, height: 140, borderRadius: "50%", border: `10px solid ${C.gold}`,
          boxShadow: `0 0 ${last !== undefined && f - last < 30 ? 60 : 20}px ${C.gold}`, transform: `scale(${down})`, background: "#1d1719",
        }}
      />
    </div>
  );
};

const Person: React.FC<{ name: string; color: string; arrive: number; from: number; y: number }> = ({ name, color, arrive, from, y }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [arrive - 70, arrive], [from, from > 420 ? 620 : 140], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const here = f >= arrive + 18;
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ width: 92, height: 92, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.display, fontSize: 46, color: C.ink, boxShadow: here ? `0 0 0 6px ${C.ink}, 0 0 0 10px ${C.mint}` : "none" }}>
        {name[0]}
      </div>
      <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: "0.2em", color: C.cream }}>{name.toUpperCase()}</div>
      {here ? <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 18, color: C.mint, letterSpacing: "0.1em", transform: `scale(${pop(f, arrive + 18)})` }}>✓ RING CONFIRMED</div> : null}
    </div>
  );
};

/** What PairUp keeps from each press: its type and time. */
const EventChip: React.FC<{ at: number; time: string; y: number }> = ({ at, time, y }) => {
  const f = useCurrentFrame();
  if (f < at) return null;
  const p = pop(f, at + 6, 240, 15);
  return (
    <div style={{ position: "absolute", left: 120, top: y, fontFamily: F.mono, fontSize: 26, color: C.cream, background: "rgba(13,10,11,0.75)", border: `1.5px solid ${C.gold}66`, borderRadius: 10, padding: "10px 18px", transform: `translateY(${(1 - p) * 20}px)`, opacity: p }}>
      {`{ type: "button_press", time: "${time}" }`}
    </div>
  );
};

export const Ring: React.FC = () => {
  const f = useCurrentFrame();
  const pressMei = cue("pressMei", S), pressSam = cue("pressSam", S);
  const checkMei = cue("checkMei", S), checkSam = cue("checkSam", S);
  const both = cue("bothHere", S);
  const enter = glide(f, 6);
  const states = [
    { name: "card_ring_0_ontheway", from: 0, y0: 740, y1: 1700 },
    { name: "card_ring_1_checkedin", from: pressMei - 30, y0: 740, y1: 1700 },
    { name: "card_ring_2_meiconfirmed", from: checkMei, y0: 740, y1: 1700 },
    { name: "card_ring_3_bothhere_mei", from: checkSam, y0: 740, y1: 1700 },
  ];
  const cur = [...states].reverse().find((s) => f >= s.from)!;
  const swap = f - cur.from < 8 ? 0.97 + 0.03 * ((f - cur.from) / 8) : 1;
  const bothP = pop(f, both, 200, 14);
  const watchIn = glide(f, both + 30);
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 22% 50%, ${C.gold}22, transparent 40%)` }} />
        <Kicker style={{ position: "absolute", left: 120, top: 140, opacity: ramp(f, 8, 12) }}>PairUp Point · HUB north entrance</Kicker>
        <div style={{ position: "absolute", left: 120, top: 180, fontFamily: F.serif, fontStyle: "italic", fontSize: 40, color: C.creamDim, opacity: ramp(f, 14, 12) }}>one doorbell · no staff · demo location</div>
        <div style={{ transform: `translateY(${(1 - enter) * 300}px)`, opacity: enter }}>
          <Doorbell presses={[pressMei, pressSam]} />
          <Person name="Mei" color={C.gold} arrive={pressMei} from={-200} y={560} />
          <Person name="Sam" color={C.rouge} arrive={pressSam} from={900} y={560} />
          <EventChip at={pressMei} time="11:41 AM" y={790} />
          <EventChip at={pressSam} time="11:44 AM" y={850} />
        </div>
        <div style={{ position: "absolute", left: 1020, top: 170, transform: `translateX(${(1 - enter) * 600}px) scale(${swap})`, opacity: enter }}>
          <CardWindow name={cur.name} y0={cur.y0} y1={cur.y1} width={780} />
        </div>
        {f >= both ? (
          <div style={{ position: "absolute", left: 1010, top: 770, transform: `scale(${bothP})`, transformOrigin: "left center" }}>
            <Slam at={both} size={130} color={C.mint}>Both here.</Slam>
          </div>
        ) : null}
        {f >= both + 20 ? (
          <div style={{ position: "absolute", left: 1660, top: 640, transform: `translateY(${(1 - watchIn) * 400}px) rotate(${-6 + 6 * watchIn}deg)` }}>
            <div style={{ width: 200, height: 246, borderRadius: 56, background: "#0b0a0b", border: "10px solid #3a3236", boxShadow: "0 30px 90px rgba(0,0,0,0.6)", overflow: "hidden" }}>
              <Img src={cap("watch_mei_bothhere")} style={{ width: "100%" }} />
            </div>
          </div>
        ) : null}
        <Label text="Local simulated webhook" x={1490} />
        <Label text="Watch: browser preview" x={1490} y={110} delay={both + 20} />
      </Backdrop>
    </AbsoluteFill>
  );
};

export const RING_END = fb(10);
