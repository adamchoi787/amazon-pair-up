import { categoryOf, icon, type IconName } from '../design/icons.js';
import type { Auth } from './auth.js';
import { Mcp, resultData } from './mcp.js';

// For you: suggestions from routines and devices, in one compact dock above the
// composer. One suggestion at a time; it collapses to a single row while the
// user talks, so the conversation and its deal card keep the room.

interface Suggestion {
  suggestion_id: string; say: string; reason: string; from: string; heard: string | null;
  request: { need: string; kind: 'item' | 'service'; max_price: number | null; price_unit?: string; pickup: string | null; location: string | null; schedule: string | null };
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;
};
const iconButton = (name: IconName, label: string) => {
  const b = node('button', '', 'icon-btn'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.append(icon(name, 18)); return b;
};
const SOURCE: Record<string, string> = { bee: 'From your Bee', watch: 'From your watch', phone: 'From your phone' };
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let items: Suggestion[] = [];
let index = 0;

function strip() { return document.getElementById('for-you')!; }

export function collapseSuggestions() { setOpen(false); }

function setOpen(open: boolean) {
  const el = strip();
  el.dataset.open = String(open);
  el.querySelector('.fy-toggle')?.setAttribute('aria-expanded', String(open));
  const body = el.querySelector<HTMLElement>('.fy-body');
  if (body) body.inert = !open;
}

export async function refreshSuggestions(mcp: Mcp, onChange: () => void = () => undefined) {
  const el = strip();
  try {
    const r = await mcp.call('get_suggestions', {});
    if (r.isError) throw Error(String(resultData(r).say));
    items = (resultData(r).suggestions as Suggestion[]).slice(0, 5);
    index = Math.min(index, Math.max(0, items.length - 1));
    el.hidden = !items.length;
    if (items.length) draw(mcp, onChange);
  } catch {
    el.hidden = false;
    el.replaceChildren(node('p', 'Suggestions are unavailable. Try again in a moment.', 'fy-meta fy-error'));
  }
}

function draw(mcp: Mcp, onChange: () => void) {
  const el = strip();
  // Open on wide screens; on a phone it starts as one row, so the conversation keeps the room.
  if (!el.dataset.seen) { el.dataset.seen = 'true'; el.dataset.open = String(!matchMedia('(max-width: 760px)').matches); }
  const open = el.dataset.open !== 'false';
  const s = items[index];

  const toggle = node('button', '', 'fy-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', 'fy-body');
  toggle.append(icon('sparkle', 18), node('span', 'For you'), node('span', `· ${sentence(s.request.need)}`, 'fy-peek'));
  toggle.onclick = () => setOpen(el.dataset.open === 'false');

  const bar = node('div', '', 'fy-bar');
  bar.append(toggle);
  if (items.length > 1) {
    const pager = node('div', '', 'fy-pager');
    const prev = iconButton('left', 'Previous suggestion'), next = iconButton('right', 'Next suggestion');
    prev.disabled = index === 0; next.disabled = index === items.length - 1;
    prev.onclick = () => { index--; draw(mcp, onChange); };
    next.onclick = () => { index++; draw(mcp, onChange); };
    pager.append(prev, node('span', `${index + 1} of ${items.length}`), next);
    bar.append(pager);
  }
  // A larger target for the same toggle; keyboard and screen readers use the labelled button.
  const chevron = iconButton('chevron', '');
  chevron.classList.add('fy-chevron'); chevron.tabIndex = -1; chevron.setAttribute('aria-hidden', 'true'); chevron.removeAttribute('aria-label'); chevron.removeAttribute('title');
  chevron.onclick = toggle.onclick;
  bar.append(chevron);

  const body = node('div', '', 'fy-body'); body.id = 'fy-body';
  const clip = node('div', '', 'fy-clip');
  clip.append(card(s, mcp, onChange));
  body.append(clip);
  el.replaceChildren(bar, body);
  setOpen(open);
}

function card(s: Suggestion, mcp: Mcp, onChange: () => void) {
  const article = node('article', '', 'fy-card');
  const tile = node('span', '', 'tile');
  tile.append(icon(s.from === 'routine' ? 'clock' : categoryOf(s.request.kind, s.request.pickup)));

  const text = node('div');
  const route = s.request.pickup && s.request.location ? `${s.request.pickup} → ${s.request.location}` : null;
  const meta = s.from === 'routine'
    ? [route, s.request.max_price != null ? `about $${s.request.max_price}` : null, s.request.schedule].filter(Boolean).join(' · ') || s.reason
    : `${SOURCE[s.from] ?? 'Picked up for you'}${s.heard ? ` · “${s.heard}”` : ''}`;
  text.append(node('p', s.from === 'routine' ? `Your usual: ${s.request.need}` : sentence(s.request.need), 'fy-title'), node('p', meta, 'fy-meta'));

  const actions = node('div', '', 'fy-actions');
  const status = node('p', '', 'fy-status'); status.setAttribute('role', 'status');
  const field = node('label', '', 'money-field');
  const budget = node('input'); budget.type = 'number'; budget.min = '0.01'; budget.max = '100000'; budget.step = '0.01';
  budget.inputMode = 'decimal'; budget.placeholder = 'Budget'; budget.setAttribute('aria-label', 'Your maximum budget');
  field.append(node('span', '$'), budget);
  if (s.request.max_price === null) actions.append(field);

  const buttons: [string, string, 'accept_suggestion' | 'dismiss_suggestion', Record<string, unknown>, string?][] = [
    [s.request.max_price === null ? 'Find it' : 'Ask now', 'btn primary sm', 'accept_suggestion', {}],
    ['Not now', 'btn secondary sm', 'dismiss_suggestion', {}],
    ['Forget', 'btn quiet sm', 'dismiss_suggestion', { forget: true }, 'Stop suggesting this'],
  ];
  for (const [label, cls, tool, extra, title] of buttons) {
    const b = node('button', label, cls); b.type = 'button'; if (title) b.title = title;
    b.onclick = async () => {
      const max_price = s.request.max_price ?? Number(budget.value);
      if (tool === 'accept_suggestion' && !(max_price > 0)) { status.className = 'fy-status'; status.textContent = 'Enter your budget first.'; budget.focus(); return; }
      const all = Array.from(actions.querySelectorAll('button')); all.forEach((x) => (x.disabled = true));
      try {
        const res = await mcp.call(tool, { suggestion_id: s.suggestion_id, ...extra, ...(tool === 'accept_suggestion' ? { max_price, idempotency_key: crypto.randomUUID() } : {}) });
        status.textContent = String(resultData(res).say ?? '');
        if (!res.isError) {
          status.className = 'fy-status done';
          actions.remove();
          onChange();
          // Let the confirmation read for a moment, then move on.
          setTimeout(() => void refreshSuggestions(mcp, onChange), 2200);
        }
      } catch { status.textContent = 'Could not reach PairUp. Please try again.'; }
      finally { all.forEach((x) => (x.disabled = false)); }
    };
    actions.append(b);
  }
  article.append(tile, text, actions, status);
  return article;
}

// ---------- devices ----------

export async function showDevices(auth: Auth) {
  const panel = document.getElementById('panel-devices')!;
  const head = node('div', '', 'panel-head');
  head.append(node('h2', 'Devices'), node('p', 'Talk to PairUp from your watch, Bee or phone.'));

  const connect = node('section', '', 'dev-card');
  const kind = node('select', '', 'field'); kind.setAttribute('aria-label', 'Device type');
  for (const k of ['watch', 'bee', 'phone']) { const o = node('option', k === 'watch' ? 'Apple Watch' : k === 'bee' ? 'Bee' : 'Phone'); o.value = k; kind.append(o); }
  const label = node('input', '', 'field'); label.placeholder = 'Device name'; label.maxLength = 40; label.setAttribute('aria-label', 'Device name');
  const create = node('button', 'Create token', 'btn primary'); create.type = 'button';
  const form = node('div', '', 'dev-form'); form.append(kind, label, create);
  const status = node('p', '', 'status-line'); status.setAttribute('role', 'status');
  const secret = node('div', '', 'secret'); secret.setAttribute('aria-live', 'polite');
  const links = node('p', '', 'dev-links');
  const watch = node('a', 'Open the watch view'); watch.href = '/watch/'; links.append(watch);
  connect.append(node('h3', 'Connect a device'), node('p', 'Each token is shown once and can be revoked here.'), form, status, secret, links);

  const listCard = node('section', '', 'dev-card');
  const list = node('div');
  listCard.append(node('h3', 'Connected'), list);

  const wrap = node('div', '', 'devices'); wrap.append(connect, listCard);
  panel.replaceChildren(head, wrap);

  const load = async () => {
    const r = await auth.fetch('/api/devices'); if (!r.ok) throw Error('Could not load your devices.');
    const data = await r.json() as { devices: { device_id: string; label: string; kind: string }[] }; list.replaceChildren();
    if (!data.devices.length) list.append(node('p', 'No devices connected yet.', 'status-line'));
    for (const d of data.devices) {
      const row = node('div', '', 'dev-row'), tile = node('span', '', 'tile'), text = node('div', '', 'grow');
      tile.append(icon(d.kind === 'watch' ? 'watch' : d.kind === 'bee' ? 'bee' : 'devices'));
      text.append(node('strong', d.label), node('small', d.kind === 'watch' ? 'Apple Watch' : d.kind === 'bee' ? 'Bee' : 'Phone'));
      const revoke = node('button', 'Revoke', 'btn secondary sm'); revoke.type = 'button';
      revoke.onclick = async () => {
        revoke.disabled = true;
        try {
          const r = await auth.fetch(`/api/devices/${encodeURIComponent(d.device_id)}`, { method: 'DELETE' });
          if (!r.ok) throw Error('Could not revoke this device.'); secret.replaceChildren(); await load();
        } catch (e) { status.textContent = (e as Error).message; } finally { revoke.disabled = false; }
      };
      row.append(tile, text, revoke); list.append(row);
    }
  };
  create.onclick = async () => {
    create.disabled = true; secret.replaceChildren(); status.textContent = '';
    try {
      const r = await auth.fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind.value, label: label.value || undefined }) });
      const data = await r.json(); if (!r.ok) throw Error(data.say ?? 'Could not create a token.');
      const instructions = `Token (shown once): ${data.token}\nVoice URL: ${data.endpoints.voice}\nContext URL: ${data.endpoints.context}\n\nShortcut: Dictate Text → Get Contents of URL (POST)\nAuthorization: Bearer ${data.token}\nJSON: {"text": "[Dictated Text]", "time_zone": "${Intl.DateTimeFormat().resolvedOptions().timeZone}"}\nGet Dictionary Value: say → Speak Text\nName your Shortcut PairUp, then say “Hey Siri, PairUp”.`;
      const pre = node('pre', instructions), copy = node('button', 'Copy Shortcut steps', 'btn primary sm'), hide = node('button', 'Hide token', 'btn secondary sm');
      copy.type = 'button'; hide.type = 'button';
      copy.onclick = () => void navigator.clipboard.writeText(instructions).then(() => { status.textContent = 'Copied.'; }, () => { status.textContent = 'Select and copy the steps above.'; });
      hide.onclick = () => secret.replaceChildren();
      const row = node('div', '', 'dev-links'); row.append(copy, hide);
      secret.append(pre, row); await load();
    } catch (e) { status.textContent = (e as Error).message; } finally { create.disabled = false; }
  };
  try { await load(); } catch (e) { status.textContent = (e as Error).message; }
}
