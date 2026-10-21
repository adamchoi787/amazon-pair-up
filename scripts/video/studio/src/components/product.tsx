import React from "react";
import { Img, useCurrentFrame } from "remotion";
import { C, F } from "../lib/theme";
import { cap } from "./base";

/** A captured MCP Apps card, optionally cropped to its top `crop` pixels (capture scale). */
export const Card: React.FC<{ name: string; width: number; natural: [number, number]; crop?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  name, width, natural, crop, style, children,
}) => {
  const scale = width / natural[0];
  const h = (crop ?? natural[1]) * scale;
  return (
    <div style={{ position: "absolute", width, height: h, borderRadius: 26 * (width / 600), overflow: "hidden", boxShadow: "0 50px 120px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(247,235,217,0.12)", ...style }}>
      <Img src={cap(name)} style={{ width, display: "block" }} />
      {children}
    </div>
  );
};

/** A glowing highlight over a region of a card, in capture pixels scaled to `scale`. */
export const Spot: React.FC<{ at: number; x: number; y: number; w: number; h: number; scale: number; color?: string }> = ({ at, x, y, w, h, scale, color = C.gold }) => {
  const f = useCurrentFrame();
  if (f < at) return null;
  const p = Math.min(1, (f - at) / 8);
  const pulse = 0.6 + 0.4 * Math.sin((f - at) / 6);
  return (
    <div
      style={{
        position: "absolute", left: x * scale - 10, top: y * scale - 8, width: w * scale + 20, height: h * scale + 16, borderRadius: 14,
        border: `3px solid ${color}`, boxShadow: `0 0 ${30 * pulse}px ${color}, inset 0 0 ${20 * pulse}px ${color}55`, opacity: p,
        transform: `scale(${1.15 - 0.15 * p})`,
      }}
    />
  );
};

/** Animated voice bars while a person speaks. */
export const Voice: React.FC<{ on: boolean; color?: string; bars?: number; height?: number }> = ({ on, color = C.rouge, bars = 14, height = 70 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", height }}>
      {Array.from({ length: bars }, (_, i) => {
        const v = on ? Math.abs(Math.sin(f / 3.7 + i * 0.9) * Math.sin(f / 8.3 + i * 0.4)) : 0.05;
        return <div key={i} style={{ width: 8, height: 8 + (height - 8) * v, borderRadius: 4, background: i % 3 === 0 ? C.cream : color }} />;
      })}
    </div>
  );
};

export const Who: React.FC<{ name: string; role: string; color?: string }> = ({ name, role, color = C.rouge }) => (
  <div>
    <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: "0.3em", textTransform: "uppercase", color }}>{role}</div>
    <div style={{ fontFamily: F.display, fontSize: 120, color: C.cream, lineHeight: 1, textTransform: "uppercase" }}>{name}</div>
  </div>
);

/** A rubber-stamp word that thumps in with a slight rotation. */
export const Stamp: React.FC<{ at: number; text: string; color?: string; size?: number; rot?: number; style?: React.CSSProperties }> = ({
  at, text, color = C.rouge, size = 110, rot = -8, style,
}) => {
  const f = useCurrentFrame();
  if (f < at) return null;
  const t = f - at;
  const s = t < 5 ? 2.2 - 1.2 * (t / 5) : 1 + 0.06 * Math.exp(-(t - 5) / 4) * Math.cos((t - 5) / 1.5);
  return (
    <div
      style={{
        position: "absolute", fontFamily: F.display, fontSize: size, color, border: `${size * 0.07}px solid ${color}`, borderRadius: size * 0.12,
        padding: `${size * 0.02}px ${size * 0.18}px`, transform: `rotate(${rot}deg) scale(${s})`, opacity: Math.min(1, t / 3), textTransform: "uppercase",
        lineHeight: 1.05, mixBlendMode: "normal", ...style,
      }}
    >
      {text}
    </div>
  );
};
