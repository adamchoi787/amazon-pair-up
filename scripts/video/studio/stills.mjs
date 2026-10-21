// Renders review stills: node stills.mjs <bar> [bar ...]  -> ../../../video/stills/bar-<n>.jpg
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../video/stills");
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(here, "src/index.ts") });
const comp = await selectComposition({ serveUrl, id: "PairUpPicture", inputProps: { audio: false } });
for (const b of process.argv.slice(2)) {
  const frame = Math.round(Number(b) * 96);
  const file = join(out, `bar-${b}.jpg`);
  await renderStill({ serveUrl, composition: comp, frame, output: file, imageFormat: "jpeg", jpegQuality: 85, scale: 0.5, inputProps: { audio: false } });
  console.log("still", file);
}
