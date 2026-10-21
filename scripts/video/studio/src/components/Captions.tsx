import React from "react";
import { useCurrentFrame } from "remotion";
import { C, F } from "../lib/theme";
import { FPS, VO } from "../lib/time";

const WHO: Record<string, string> = { sam: "Sam", mei: "Mei", tony: "Tony", pairup: "PairUp" };
const MAX = 8; // words per caption chunk
// Lines already shown as big on-screen type.
const ON_SCREEN = new Set(["n04", "n10", "n26", "n27", "mei2", "sam1", "mei1"]);

/** Burned-in captions: one short chunk at a time, the spoken word lit in marigold. */
export const Captions: React.FC<{ hide?: (t: number) => boolean }> = ({ hide }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  if (hide?.(t)) return null;
  const line = VO.find((l) => t >= l.start - 0.05 && t <= l.start + l.duration + 0.25);
  if (!line || ON_SCREEN.has(line.id)) return null;
  const words = line.words;
  let cur = words.findIndex((w, i) => t >= w.t && (i === words.length - 1 || t < words[i + 1].t));
  if (cur < 0) cur = 0;
  // Even chunks of at most MAX words, each ending at punctuation when one is near.
  const n = words.length;
  const k = Math.ceil(n / MAX);
  const chunks: number[][] = [];
  let i0 = 0;
  for (let c = 0; c < k; c++) {
    let end = c === k - 1 ? n : Math.round(((c + 1) * n) / k);
    if (c < k - 1) {
      for (const d of [0, -1, 1, -2, 2]) {
        const e = end + d;
        if (e > i0 + 2 && e < n - 1 && /[.,!?:]$/.test(words[e - 1].w)) { end = e; break; }
      }
    }
    chunks.push(Array.from({ length: end - i0 }, (_, j) => i0 + j));
    i0 = end;
  }
  const chunk = chunks.find((c) => c.includes(cur)) ?? chunks[0];
  const who = WHO[line.who];
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 58, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          display: "flex", alignItems: "baseline", gap: 16, padding: "12px 26px", borderRadius: 14,
          background: "rgba(13,10,11,0.62)", backdropFilter: "blur(8px)", boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
          fontFamily: F.sans, fontWeight: 500, fontSize: 38, color: C.cream, letterSpacing: "-0.01em", maxWidth: 1500,
        }}
      >
        {who ? (
          <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: "0.2em", textTransform: "uppercase", color: line.who === "pairup" ? C.gold : C.rouge }}>{who}</span>
        ) : null}
        <span>
          {chunk.map((i) => (
            <span key={i} style={{ color: i === cur ? C.gold : i < cur ? C.cream : "rgba(247,235,217,0.55)" }}>
              {words[i].w}{" "}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
};
