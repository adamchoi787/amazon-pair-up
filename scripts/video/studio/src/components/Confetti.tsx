import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../lib/theme";

const rand = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Deterministic confetti burst from (x, y) starting at frame `at`. */
export const Confetti: React.FC<{ at: number; x?: number; y?: number; count?: number; colors?: string[]; power?: number }> = ({
  at, x = 960, y = 540, count = 140, colors = [C.gold, C.rouge, C.cream, "#ffd98a"], power = 1,
}) => {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 150) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const a = rand(i, 1) * Math.PI * 2;
        const v = (8 + rand(i, 2) * 26) * power;
        const drag = Math.exp(-t / 28);
        const dx = Math.cos(a) * v * 28 * (1 - drag);
        const dy = Math.sin(a) * v * 28 * (1 - drag) - 18 * (1 - drag) * 10 + 0.09 * t * t * (0.6 + rand(i, 3));
        const w = 10 + rand(i, 4) * 16;
        const spin = t * (6 + rand(i, 5) * 14) * (rand(i, 6) > 0.5 ? 1 : -1);
        const o = Math.min(1, (150 - t) / 30);
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: x + dx, top: y + dy, width: w, height: w * (rand(i, 7) > 0.5 ? 0.45 : 1),
              borderRadius: rand(i, 8) > 0.7 ? "50%" : 2, background: colors[i % colors.length], opacity: o,
              transform: `rotate(${spin}deg) rotateX(${spin * 1.3}deg)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
