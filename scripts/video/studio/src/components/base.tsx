import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, F } from "../lib/theme";
import { clamp, pop, ramp } from "../lib/time";

export const cap = (name: string) => staticFile(`assets/cap/${name}.png`);

/** Animated film grain (SVG turbulence with a new seed every other frame). */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.09 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "overlay", opacity }}>
      <svg width="100%" height="100%">
        <filter id={`g${Math.floor(f / 2) % 8}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.floor(f / 2) % 8} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${Math.floor(f / 2) % 8})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.65 }) => (
  <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(0,0,0,${strength}) 100%)` }} />
);

/** Sunburst rays drawn in code, like a cabaret poster; slowly rotating. */
export const Rays: React.FC<{ color?: string; opacity?: number; count?: number; speed?: number; cx?: number; cy?: number }> = ({
  color = C.rouge, opacity = 0.18, count = 28, speed = 0.08, cx = 960, cy = 540,
}) => {
  const f = useCurrentFrame();
  const r = 2400;
  const paths = Array.from({ length: count }, (_, i) => {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = a0 + Math.PI / count;
    return `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
  });
  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={1920} height={1080} style={{ transform: `rotate(${f * speed}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        {paths.map((d, i) => <path key={i} d={d} fill={color} />)}
      </svg>
    </AbsoluteFill>
  );
};

/** Halftone dot field, fading toward one corner. */
export const Halftone: React.FC<{ color?: string; opacity?: number; size?: number; angle?: number }> = ({
  color = C.cream, opacity = 0.08, size = 18, angle = 135,
}) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage: `radial-gradient(${color} 22%, transparent 24%)`,
      backgroundSize: `${size}px ${size}px`,
      WebkitMaskImage: `linear-gradient(${angle}deg, black 0%, transparent 65%)`,
      maskImage: `linear-gradient(${angle}deg, black 0%, transparent 65%)`,
    }}
  />
);

export const Backdrop: React.FC<{ tone?: "ink" | "velvet" | "rouge" | "cobalt" | "cream"; children?: React.ReactNode; rays?: boolean; dots?: boolean }> = ({
  tone = "velvet", children, rays = false, dots = true,
}) => {
  const bg = {
    ink: `radial-gradient(ellipse 80% 70% at 50% 45%, #1a1214 0%, ${C.ink} 70%)`,
    velvet: `radial-gradient(ellipse 90% 80% at 50% 40%, ${C.velvet2} 0%, ${C.velvet} 45%, ${C.ink} 100%)`,
    rouge: `radial-gradient(ellipse 80% 75% at 50% 45%, #ff6a4a 0%, ${C.rouge} 40%, ${C.rougeDeep} 100%)`,
    cobalt: `radial-gradient(ellipse 85% 80% at 50% 40%, #2b3fd6 0%, ${C.cobaltDeep} 55%, #060824 100%)`,
    cream: `radial-gradient(ellipse 85% 80% at 50% 40%, #fff7ea 0%, ${C.cream} 55%, #e8d6bb 100%)`,
  }[tone];
  const dark = tone !== "cream" && tone !== "rouge";
  return (
    <AbsoluteFill style={{ background: bg }}>
      {rays ? <Rays color={tone === "rouge" ? "#fff2" : tone === "cream" ? C.rouge : C.rouge} opacity={tone === "rouge" ? 0.35 : tone === "cream" ? 0.1 : 0.12} /> : null}
      {dots ? <Halftone color={dark ? C.cream : C.ink} opacity={dark ? 0.06 : 0.07} /> : null}
      {children}
    </AbsoluteFill>
  );
};

/** A phone in the film's own device frame, showing real app captures. */
export const Phone: React.FC<{
  shots: { src: string; from?: number }[]; height?: number; style?: React.CSSProperties; glow?: string; scrollY?: number;
}> = ({ shots, height = 860, style, glow = C.rouge, scrollY = 0 }) => {
  const f = useCurrentFrame();
  const w = height * (430 / 932);
  const bez = height * 0.022;
  return (
    <div style={{ position: "absolute", width: w + bez * 2, height: height + bez * 2, ...style }}>
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: height * 0.075, background: "linear-gradient(145deg,#3a3236,#121012 40%,#0a090a)",
          boxShadow: `0 0 0 2px #4a4044, 0 40px 120px rgba(0,0,0,0.65), 0 0 140px ${glow}33`,
        }}
      />
      <div style={{ position: "absolute", left: bez, top: bez, width: w, height, borderRadius: height * 0.06, overflow: "hidden", background: "#0e0d12" }}>
        {shots.map((s, i) => {
          const next = shots[i + 1];
          const on = f >= (s.from ?? 0) && (!next || f < (next.from ?? 0) + 6);
          if (!on) return null;
          const o = i === 0 ? 1 : interpolate(f, [s.from ?? 0, (s.from ?? 0) + 6], [0, 1], clamp);
          return <Img key={s.src} src={s.src} style={{ position: "absolute", width: "100%", top: -scrollY, opacity: o }} />;
        })}
        <div style={{ position: "absolute", top: height * 0.012, left: "50%", width: w * 0.3, height: height * 0.034, marginLeft: -w * 0.15, borderRadius: 99, background: "#000" }} />
      </div>
    </div>
  );
};

/** Required truth labels, styled as small stage tickets. */
export const Label: React.FC<{ text: string; x?: number; y?: number; delay?: number; tone?: "dark" | "light" }> = ({ text, x = 64, y = 56, delay = 0, tone = "dark" }) => {
  const f = useCurrentFrame();
  const o = ramp(f, delay, 12);
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, opacity: o, transform: `translateY(${(1 - o) * -10}px)`,
        fontFamily: F.sans, fontWeight: 700, fontSize: 19, letterSpacing: "0.16em", textTransform: "uppercase",
        color: tone === "dark" ? C.cream : C.ink, padding: "10px 18px", borderRadius: 6,
        border: `1.5px solid ${tone === "dark" ? "rgba(247,235,217,0.45)" : "rgba(13,10,11,0.5)"}`,
        background: tone === "dark" ? "rgba(13,10,11,0.55)" : "rgba(247,235,217,0.6)",
      }}
    >
      {text}
    </div>
  );
};

/** Big poster type that slams in on a beat. */
export const Slam: React.FC<{ at: number; children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties; from?: number; font?: string }> = ({
  at, children, size = 160, color = C.cream, style, from = 1.8, font = F.display,
}) => {
  const f = useCurrentFrame();
  if (f < at) return null;
  const p = pop(f, at, 320, 16, 0.6);
  const s = from + (1 - from) * p;
  const blur = Math.max(0, (1 - p) * 14);
  return (
    <div style={{ fontFamily: font, fontSize: size, lineHeight: 0.92, color, transform: `scale(${s})`, filter: `blur(${blur}px)`, opacity: Math.min(1, p * 2.5), textTransform: font === F.display ? "uppercase" : undefined, ...style }}>
      {children}
    </div>
  );
};

/** Diagonal kick-line stripes sweeping across: the film's cut. */
export const StripeWipe: React.FC<{ at: number; dur?: number; colors?: string[] }> = ({ at, dur = 18, colors = [C.rouge, C.cream, C.ink] }) => {
  const f = useCurrentFrame();
  if (f < at - 2 || f > at + dur + 2) return null;
  const p = interpolate(f, [at, at + dur], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {colors.map((c, i) => {
        const d = Math.min(1, Math.max(0, p * 1.6 - i * 0.18));
        const x = interpolate(d, [0, 0.5, 1], [-2600, 0, 2600], { easing: (t) => t });
        return <div key={i} style={{ position: "absolute", top: -400, left: x - 400, width: 2200 + 400, height: 1900, background: c, transform: "skewX(-22deg)" }} />;
      })}
    </AbsoluteFill>
  );
};

/** The motif: two circles, the buyer and the seller. t: 0 apart → 1 overlapping as the mark. */
export const Dots: React.FC<{ t: number; size?: number; x?: number; y?: number; gap?: number; glow?: boolean; colors?: [string, string] }> = ({
  t, size = 120, x = 960, y = 540, gap = 600, glow = true, colors = [C.rouge, C.cream],
}) => {
  const off = interpolate(t, [0, 1], [gap / 2, size * 0.28]);
  const common: React.CSSProperties = { position: "absolute", width: size, height: size, borderRadius: "50%", top: y - size / 2 };
  return (
    <>
      <div style={{ ...common, left: x - off - size / 2, background: colors[0], boxShadow: glow ? `0 0 ${size}px ${colors[0]}88` : undefined }} />
      <div style={{ ...common, left: x + off - size / 2, background: colors[1], mixBlendMode: "screen", boxShadow: glow ? `0 0 ${size}px ${colors[1]}66` : undefined }} />
    </>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.gold, style }) => (
  <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 24, letterSpacing: "0.32em", textTransform: "uppercase", color, ...style }}>{children}</div>
);
