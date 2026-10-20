// Builds the browser code:
//   src/design/tokens.json → public/design/tokens.css (shared design tokens)
//   src/web/main.ts  → public/app/app.js            (the PairUp web app)
//   src/apps/view.ts → public/mcp-apps/market.html  (single-file MCP Apps view)
// The output is committed so the server runs without a build step; CI rebuilds
// and fails if the committed files are out of date.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

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

// One token set for every surface. The app, watch and dashboard link the file;
// the MCP Apps card inlines it. Light by default; dark follows the system unless
// a page pins data-theme, and the MCP view always pins the host's theme.
const tokens = JSON.parse(readFileSync("src/design/tokens.json", "utf8"));
const decls = (indent, ...groups) => groups.flatMap((g) => Object.entries(g).map(([k, v]) => `${indent}--${k}: ${v};`)).join("\n");
const tokensCss = `/* Generated from src/design/tokens.json by scripts/build-web.mjs. Edit the JSON, then run npm run build:web. */
:root {
${decls("  ", tokens.font, tokens.text, tokens.space, tokens.radius, tokens.motion, tokens.color.light, tokens.shadow.light)}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${decls("    ", tokens.color.dark, tokens.shadow.dark)}
    color-scheme: dark;
  }
}
:root[data-theme="dark"], .theme-dark {
${decls("  ", tokens.color.dark, tokens.shadow.dark)}
  color-scheme: dark;
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-instant: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; --dur-slower: 0ms; --rise: 0px; }
}
`;
mkdirSync("public/design", { recursive: true });
writeFileSync("public/design/tokens.css", tokensCss);

await build({ ...common, entryPoints: ["src/web/main.ts"], outfile: "public/app/app.js" });

await build({ ...common, entryPoints: ["src/web/watch.ts"], outfile: "public/watch/watch.js" });

const view = await build({ ...common, entryPoints: ["src/apps/view.ts"], write: false });
const js = view.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = tokensCss + readFileSync("src/apps/view.css", "utf8").replace(/\r\n/g, "\n");
mkdirSync("public/mcp-apps", { recursive: true });
writeFileSync(
  "public/mcp-apps/market.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>PairUp</title><style>${css}</style></head><body><div id="root"></div>` +
    `<script type="module">${js}</script></body></html>\n`,
);

const size = (f) => `${(readFileSync(f).length / 1024).toFixed(0)} KB`;
const fingerprint = createHash("sha256");
for (const path of ["public/design/tokens.css", "public/app/index.html", "public/app/app.js", "public/mcp-apps/market.html", "public/watch/index.html", "public/watch/watch.js"]) {
  fingerprint.update(path).update("\0").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).update("\0");
}
writeFileSync("public/build-info.json", JSON.stringify({ version: JSON.parse(readFileSync("package.json", "utf8")).version, fingerprint: fingerprint.digest("hex") }, null, 2) + "\n");
console.log(`public/app/app.js ${size("public/app/app.js")} · public/mcp-apps/market.html ${size("public/mcp-apps/market.html")}`);
