// Builds the browser code:
//   src/web/main.ts  → public/app/app.js            (the VoiceMarket web app)
//   src/apps/view.ts → public/mcp-apps/market.html  (single-file MCP Apps view)
// The output is committed so the server runs without a build step; CI rebuilds
// and fails if the committed files are out of date.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

await build({ ...common, entryPoints: ["src/web/main.ts"], outfile: "public/app/app.js" });

const view = await build({ ...common, entryPoints: ["src/apps/view.ts"], write: false });
const js = view.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/apps/view.css", "utf8");
mkdirSync("public/mcp-apps", { recursive: true });
writeFileSync(
  "public/mcp-apps/market.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>VoiceMarket</title><style>${css}</style></head><body><div id="root"></div>` +
    `<script type="module">${js}</script></body></html>\n`,
);

const size = (f) => `${(readFileSync(f).length / 1024).toFixed(0)} KB`;
console.log(`public/app/app.js ${size("public/app/app.js")} · public/mcp-apps/market.html ${size("public/mcp-apps/market.html")}`);
