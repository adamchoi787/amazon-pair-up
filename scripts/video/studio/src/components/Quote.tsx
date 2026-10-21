import React from "react";
import { useCurrentFrame } from "remotion";
import { C, F } from "../lib/theme";
import { FPS, VO } from "../lib/time";

/** A spoken request, word by word as it is said: the voice command made visible. */
export const Quote: React.FC<{ id: string; sceneStartBar: number; size?: number; width?: number; accent?: string }> = ({ id, sceneStartBar, size = 68, width = 860, accent = C.gold }) => {
  const f = useCurrentFrame();
  const line = VO.find((l) => l.id === id)!;
  const t = f / FPS + sceneStartBar * 1.6;
  return (
    <div style={{ width, fontFamily: F.serif, fontStyle: "italic", fontSize: size, lineHeight: 1.12, color: C.cream }}>
      <span style={{ color: accent, opacity: t >= line.start - 0.1 ? 1 : 0 }}>“</span>
      {line.words.map((w, i) => {
        const dt = t - w.t;
        if (dt < 0) return null;
        const p = Math.min(1, dt / 0.12);
        const cur = dt < w.d + 0.05;
        return (
          <span key={i} style={{ display: "inline-block", marginRight: size * 0.24, opacity: p, transform: `translateY(${(1 - p) * 18}px)`, color: cur ? accent : C.cream }}>
            {w.w}
          </span>
        );
      })}
      <span style={{ color: accent, opacity: t >= line.start + line.duration ? 1 : 0 }}>”</span>
    </div>
  );
};
