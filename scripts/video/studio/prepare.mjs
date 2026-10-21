// Copies fonts, the mastered soundtrack and build data into public/assets for Remotion.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
const A = join(here, "public/assets");
mkdirSync(join(A, "fonts"), { recursive: true });
const fs = (pkg, file) => join(here, "node_modules/@fontsource", pkg, "files", file);
const fonts = [
  ["anton", "anton-latin-400-normal.woff2"],
  ["instrument-serif", "instrument-serif-latin-400-italic.woff2"],
  ["instrument-serif", "instrument-serif-latin-400-normal.woff2"],
  ["space-grotesk", "space-grotesk-latin-400-normal.woff2"],
  ["space-grotesk", "space-grotesk-latin-500-normal.woff2"],
  ["space-grotesk", "space-grotesk-latin-700-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-700-normal.woff2"],
];
for (const [pkg, f] of fonts) copyFileSync(fs(pkg, f), join(A, "fonts", f));
for (const [src, dst] of [["video/build/mix.wav", "mix.wav"], ["video/build/music/kicks.json", "../../src/generated/kicks.json"]]) {
  const p = join(ROOT, src);
  if (existsSync(p)) copyFileSync(p, join(A, dst));
}
console.log("prepared assets");
