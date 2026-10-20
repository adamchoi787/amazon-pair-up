// PairUp icons: one 24px grid, 1.75px round strokes, drawn in currentColor.
// Shared by the web app, the MCP Apps card and the watch view, so an item,
// an errand and a job look the same everywhere. Static markup only.

const PATHS = {
  // Categories
  item: '<path d="M5.5 8.5h13l-1.1 11a1.5 1.5 0 0 1-1.5 1.35H8.1a1.5 1.5 0 0 1-1.5-1.35z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  errand: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3.25 3.25 0 0 0 0-6.5H9a3.25 3.25 0 0 1 0-6.5h6.8"/>',
  job: '<circle cx="9.5" cy="7.5" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0"/><path d="m15.5 11.5 2 2 4-4"/>',
  sell: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.6-7.6a1 1 0 0 1-.3-.7z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  // Interface
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  muted: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  left: '<path d="M14.5 6 8.5 12l6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  sparkle: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M18.5 15.5c.25 1.5 1 2.25 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.25 2.25-1 2.5-2.5z"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.2z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  inbox: '<path d="M4 13.5 6.3 6a1.5 1.5 0 0 1 1.4-1h8.6a1.5 1.5 0 0 1 1.4 1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1.2 2h4.6l1.2-2H20"/>',
  posts: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  devices: '<rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M11 18.5h2"/>',
  chat: '<path d="M5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6.5a2.5 2.5 0 0 1-2.5 2.5H9z"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3.5"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3M12 9.5V12l1.5 1"/>',
  bee: '<ellipse cx="12" cy="13.5" rx="4.5" ry="5.5"/><path d="M7.8 12h8.4M7.8 15.5h8.4M10 8.5 8 5M14 8.5 16 5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Markup for an icon. Decorative unless the caller labels the control around it. */
export function iconMarkup(name: IconName, size = 20) {
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

export function icon(name: IconName, size = 20): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = iconMarkup(name, size);
  return t.content.firstElementChild as SVGSVGElement;
}

/** The PairUp mark: two overlapping circles, one solid, on an accent tile. */
export function markMarkup(size = 28) {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="9.5" fill="var(--accent)"/><circle cx="12.5" cy="16" r="6.25" fill="var(--accent-fg)"/><circle cx="19.5" cy="16" r="6.25" fill="none" stroke="var(--accent-fg)" stroke-width="2.4"/></svg>`;
}

export function mark(size = 28): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = markMarkup(size);
  return t.content.firstElementChild as SVGSVGElement;
}

/** Item, errand or job: what a post is, from its kind and whether it has a pickup. */
export type Category = "item" | "errand" | "job";
export const categoryOf = (kind: "item" | "service", pickup?: string | null): Category =>
  kind === "item" ? "item" : pickup ? "errand" : "job";
export const CATEGORY_LABEL: Record<Category, string> = { item: "Item", errand: "Errand", job: "Job" };
