// "Cabaret Night": the film's own art direction (docs/VIDEO_STORYBOARD.md).
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const C = {
  ink: "#0D0A0B",
  velvet: "#1C1215",
  velvet2: "#2A1A1E",
  rouge: "#FF4532",
  rougeDeep: "#C8231A",
  cream: "#F7EBD9",
  creamDim: "rgba(247,235,217,0.62)",
  gold: "#FFC23D",
  cobalt: "#3A55FF",
  cobaltDeep: "#101A5C",
  mint: "#5BE3A8",
};

export const F = {
  display: "Anton, Impact, sans-serif",
  serif: "'Instrument Serif', Georgia, serif",
  sans: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

const fonts: [string, string, string, string][] = [
  ["Anton", "anton-latin-400-normal.woff2", "400", "normal"],
  ["Instrument Serif", "instrument-serif-latin-400-italic.woff2", "400", "italic"],
  ["Instrument Serif", "instrument-serif-latin-400-normal.woff2", "400", "normal"],
  ["Space Grotesk", "space-grotesk-latin-400-normal.woff2", "400", "normal"],
  ["Space Grotesk", "space-grotesk-latin-500-normal.woff2", "500", "normal"],
  ["Space Grotesk", "space-grotesk-latin-700-normal.woff2", "700", "normal"],
  ["JetBrains Mono", "jetbrains-mono-latin-400-normal.woff2", "400", "normal"],
  ["JetBrains Mono", "jetbrains-mono-latin-700-normal.woff2", "700", "normal"],
];

export const fontsReady = Promise.all(
  fonts.map(([family, file, weight, style]) => loadFont({ family, url: staticFile(`assets/fonts/${file}`), weight, style })),
);
