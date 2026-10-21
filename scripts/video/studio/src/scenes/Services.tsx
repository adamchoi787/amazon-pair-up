import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, cap, Kicker, Label, Slam } from "../components/base";
import { Spot, Stamp } from "../components/product";
import { C, F } from "../lib/theme";
import { clamp, cue, fb, FPS, glide, pop, ramp, scene, VO } from "../lib/time";
import { ALEXA_LABEL } from "./Seller";

const S = scene("services").start;

const Crop: React.FC<{ name: string; y0: number; y1: number; width: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ name, y0, y1, width, style, children }) => {
  const k = width / 1194;
  return (
    <div style={{ position: "absolute", width, height: (y1 - y0) * k, overflow: "hidden", borderRadius: 24, background: "#16151c", boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(247,235,217,0.12)", ...style }}>
      <Img src={cap(name)} style={{ position: "absolute", width, top: -y0 * k }} />
      <div style={{ position: "absolute", left: 0, top: -y0 * k, width, height: 9999 }}>{children}</div>
    </div>
  );
};

/** The HUB → McCarty Hall route, drawn as it is described. */
const Route: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const d = "M 160 640 C 300 520, 260 380, 430 330 S 640 250, 700 150";
  const len = 820;
  const draw = ramp(f, at, 60);
  const walk = ramp(f, at + 30, 70);
  // Approximate the walker on the curve by sampling the path.
  const pts = [[160, 640], [250, 560], [300, 460], [430, 330], [560, 270], [650, 210], [700, 150]];
  const seg = walk * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(seg));
  const u = seg - i;
  const wx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, wy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u;
  const pin = (x: number, y: number, label: string, delay: number) => (
    <div style={{ position: "absolute", left: x - 30, top: y - 78, transform: `scale(${pop(f, at + delay, 300, 12)})`, transformOrigin: "bottom center" }}>
      <svg width={60} height={78} viewBox="0 0 64 84"><path d="M32 82 C32 82 4 48 4 30 A28 28 0 1 1 60 30 C60 48 32 82 32 82 Z" fill={C.rouge} /><circle cx={32} cy={30} r={11} fill={C.cream} /></svg>
      <div style={{ position: "absolute", left: 70, top: 14, whiteSpace: "nowrap", fontFamily: F.display, fontSize: 46, color: C.cream, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 60, top: 230, width: 900, height: 720 }}>
      <svg width={900} height={720} style={{ position: "absolute" }}>
        <path d={d} fill="none" stroke="rgba(247,235,217,0.15)" strokeWidth={16} strokeLinecap="round" />
        <path d={d} fill="none" stroke={C.gold} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${len * draw} ${len}`} />
      </svg>
      {pin(160, 640, "The HUB", 0)}
      {pin(700, 150, "McCarty Hall", 40)}
      {f >= at + 30 ? <div style={{ position: "absolute", left: wx - 22, top: wy - 22, width: 44, height: 44, borderRadius: "50%", background: C.cream, boxShadow: `0 0 30px ${C.gold}` }} /> : null}
    </div>
  );
};

/** A week grid: the helper's hours, the booking that fits, the overlap that is refused. */
const Week: React.FC<{ hours: number; book: number; clash: number; yes: number }> = ({ hours, book, clash, yes }) => {
  const f = useCurrentFrame();
  const X = 0, Y = 60, cw = 112, rh = 54, h0 = 9;
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const block = (day: number, from: number, to: number, color: string, at: number, fill = true, extra: React.CSSProperties = {}) => {
    const p = pop(f, at, 320, 15);
    if (f < at) return null;
    return (
      <div style={{ position: "absolute", left: X + day * cw + 6, top: Y + (from - h0) * rh, width: cw - 12, height: (to - from) * rh, borderRadius: 12, background: fill ? color : "transparent", border: `3px ${fill ? "solid" : "dashed"} ${color}`, transform: `translateY(${(1 - p) * -120}px)`, opacity: Math.min(1, p * 2), ...extra }} />
    );
  };
  const shake = f >= clash && f < clash + 24 ? Math.sin((f - clash) * 1.6) * 14 * (1 - (f - clash) / 24) : 0;
  const bounce = f >= clash + 24 ? interpolate(f, [clash + 24, clash + 44], [0, 1], clamp) : 0;
  return (
    <div style={{ position: "absolute", left: 1000, top: 200, width: 7 * cw, height: Y + 12 * rh }}>
      {days.map((d, i) => (
        <div key={d} style={{ position: "absolute", left: X + i * cw, top: 0, width: cw, textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: "0.12em", color: i === 5 ? C.gold : C.creamDim }}>{d}</div>
      ))}
      {Array.from({ length: 13 }, (_, r) => (
        <div key={r} style={{ position: "absolute", left: X, top: Y + r * rh, width: 7 * cw, height: 1, background: "rgba(247,235,217,0.12)" }} />
      ))}
      {[0, 3, 6, 9, 12].map((r) => (
        <div key={r} style={{ position: "absolute", left: -84, top: Y + r * rh - 12, fontFamily: F.mono, fontSize: 18, color: C.creamDim }}>{((h0 + r - 1) % 12) + 1}{h0 + r < 12 ? "AM" : "PM"}</div>
      ))}
      {block(5, 9, 21, C.cream, hours, false)}
      {block(6, 9, 21, C.cream, hours + 4, false)}
      {block(5, 14, 18, C.gold, book, true)}
      {f >= book ? <div style={{ position: "absolute", left: X + 5 * cw + 14, top: Y + 5 * rh + 10, fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: C.ink, lineHeight: 1.2, opacity: ramp(f, book + 6, 8) }}>2–6 PM<br />$40</div> : null}
      {block(5, 15, 17, C.rouge, clash, true, { transform: `translateX(${shake + 18 + bounce * 220}px) translateY(${-bounce * 90}px) rotate(${bounce * 16}deg)`, opacity: (1 - bounce * 0.85) * 0.92, boxShadow: `0 0 30px ${C.rouge}` })}
      {f >= clash && bounce < 0.6 ? <div style={{ position: "absolute", left: X + 5 * cw + 30, top: Y + 6 * rh + 8, fontFamily: F.sans, fontWeight: 700, fontSize: 18, color: C.cream, opacity: 1 - bounce * 1.6 }}>3–5 PM</div> : null}
      {f >= clash + 6 ? <div style={{ position: "absolute", left: X + 6 * cw + 30, top: Y + 6 * rh - 60, fontFamily: F.sans, fontWeight: 700, fontSize: 24, color: C.rouge, opacity: ramp(f, clash + 6, 8) }}>✕ overlaps</div> : null}
      {f >= hours ? <div style={{ position: "absolute", left: 0, top: Y + 12 * rh + 20, fontFamily: F.sans, fontSize: 24, color: C.creamDim, opacity: ramp(f, hours, 10) }}>Dashed: the helper's stated hours (weekends) · Pacific time</div> : null}
      <Stamp at={yes} text="Final yes: helper" color={C.mint} size={64} rot={-5} style={{ left: 60, top: Y + 1.5 * rh }} />
    </div>
  );
};

export const Services: React.FC = () => {
  const f = useCurrentFrame();
  const head = pop(f, fb(48.25 - S), 260, 15);
  const headUp = glide(f, fb(49.2 - S));
  const eventAt = cue("eventCard", S);
  const lunchOut = ramp(f, eventAt - 12, 18);
  const eventIn = glide(f, eventAt);
  const tony = VO.find((l) => l.id === "tony1")!;
  const tonyStart = Math.round((tony.start - S * 1.6) * FPS);
  return (
    <AbsoluteFill>
      <Backdrop tone="velvet">
        {/* Header slam, then it docks at the top. */}
        <div style={{ position: "absolute", left: 0, right: 0, top: interpolate(headUp, [0, 1], [400, 70]), display: "flex", justifyContent: "center", transform: `scale(${interpolate(headUp, [0, 1], [1, 0.42])})`, transformOrigin: "center top" }}>
          <Slam at={fb(48.25 - S)} size={190} color={C.cream}>It books people, too.</Slam>
        </div>
        <div style={{ opacity: (f >= tonyStart - 10 ? 1 : 0) * (1 - lunchOut), transform: `translateX(${-300 * lunchOut}px)` }}>
          <Route at={cue("route", S)} />
          <Kicker style={{ position: "absolute", left: 120, top: 200 }}>Errand · lunch run</Kicker>
          {f >= cue("fee5", S) - 20 ? (
            <div style={{ position: "absolute", left: 1180, top: 200, transform: `translateY(${(1 - glide(f, cue("fee5", S) - 20)) * 500}px)` }}>
              <Crop name="card_lunch" y0={80} y1={1500} width={600}>
                <Spot at={cue("fee5", S) + 10} x={52} y={390} w={460} h={110} scale={600 / 1194} />
                <Spot at={cue("fee5", S) + 50} x={52} y={1210} w={1080} h={260} scale={600 / 1194} color={C.gold} />
              </Crop>
            </div>
          ) : null}
        </div>
        {f >= eventAt - 6 ? (
          <div style={{ position: "absolute", left: 110, top: 190, transform: `translateX(${(1 - eventIn) * -900}px)`, opacity: eventIn }}>
            <Kicker style={{ position: "absolute", left: 0, top: -10, whiteSpace: "nowrap" }}>Job · event help, by the hour</Kicker>
            <Crop name="card_event" y0={10} y1={1370} width={600} style={{ top: 40 }}>
              <Spot at={cue("total40", S)} x={52} y={350} w={420} h={170} scale={600 / 1194} />
              <Spot at={cue("total40", S) + 50} x={52} y={830} w={1080} h={200} scale={600 / 1194} color={C.cream} />
              <Spot at={cue("block1", S)} x={52} y={1170} w={760} h={160} scale={600 / 1194} color={C.mint} />
            </Crop>
          </div>
        ) : null}
        {f >= eventAt ? <Week hours={cue("block1", S)} book={cue("block2", S)} clash={cue("overlap", S)} yes={cue("helperYes", S)} /> : null}
        <Label text={ALEXA_LABEL} x={1290} />
      </Backdrop>
    </AbsoluteFill>
  );
};
