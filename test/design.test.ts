import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The shared design tokens (src/design/tokens.json): every text and control
// pairing listed there meets WCAG 2.2 AA in both themes, and every surface
// uses the generated stylesheet.

const tokens = JSON.parse(readFileSync("src/design/tokens.json", "utf8")) as {
  color: Record<"light" | "dark", Record<string, string>>;
  contrast: [string, string, number][];
};

function luminance(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a solid hex color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} tokens meet WCAG AA contrast`, () => {
    const palette = tokens.color[theme];
    const failures = tokens.contrast
      .map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(palette[fg], palette[bg]), min }))
      .filter((c) => c.ratio < c.min)
      .map((c) => `${c.pair}: ${c.ratio.toFixed(2)} < ${c.min}`);
    assert.deepEqual(failures, []);
  });
}

test("both themes define the same tokens", () => {
  assert.deepEqual(Object.keys(tokens.color.dark).sort(), Object.keys(tokens.color.light).sort());
});

test("every surface uses the shared tokens", () => {
  const css = readFileSync("public/design/tokens.css", "utf8");
  for (const name of Object.keys(tokens.color.light)) assert.match(css, new RegExp(`--${name}:`), name);
  for (const page of ["public/app/index.html", "public/watch/index.html", "public/dashboard/index.html"]) {
    assert.match(readFileSync(page, "utf8"), /<link rel="stylesheet" href="\/design\/tokens.css">/, page);
  }
  // The MCP Apps card is one self-contained file: the tokens are inlined.
  assert.ok(readFileSync("public/mcp-apps/market.html", "utf8").includes("--accent-soft:"), "market.html");
});
