# PairUp design system

One visual language for the four surfaces: the web app (`/app/`), the MCP Apps card (`ui://pairup/market.html`, rendered by Alexa+ and every other MCP Apps host), the watch view (`/watch/`) and the live dashboard (`/dashboard/`).

## Tokens

[`src/design/tokens.json`](../src/design/tokens.json) is the single source. `npm run build:web` writes [`public/design/tokens.css`](../public/design/tokens.css) from it. The app, watch and dashboard link that file. The MCP Apps card inlines it, so the card stays one self-contained file.

| Group | Tokens |
|---|---|
| Color | `bg`, `surface`, `surface-2`, `line`, `line-strong`, `fg`, `fg-muted`, `accent` (+ `-hover`, `-fg`, `-soft`, `-ink`), `good`, `warn`, `danger` (each with `-soft`) |
| Type | `font-sans`, `font-display`; sizes `text-xs` 12 to `text-3xl` 40 and a fluid `text-display`; weights, leading, tracking |
| Space | a 4px scale, `space-1` to `space-12`, and `target` (44px, the smallest touch target) |
| Radius | `radius-sm` 8, `radius-md` 12, `radius-lg` 18, `radius-xl` 24, `radius-pill` |
| Elevation | `shadow-1` (resting card), `shadow-2` (dock, hover), `shadow-3` (sign-in card, watch), `glow` (primary action) |
| Motion | `dur-instant` 90ms to `dur-slower` 560ms; `ease-out`, `ease-in-out`, `ease-spring`; `rise` (entrance distance) |

Themes: light by default, dark from `prefers-color-scheme`. A page can pin a theme with `data-theme="light"` or `"dark"` on `<html>`, and `.theme-dark` scopes the dark palette to one element. The MCP view always pins the host's `theme` from the host context and keeps a transparent background, so it sits on the host's own surface.

To change a color, edit the JSON and run `npm run build:web`. CI rebuilds and checks that `public/design/tokens.css` matches.

## Brand

- **Mark:** two overlapping circles on an accent tile, two people meeting in the middle. It is drawn in tokens, so it follows the theme (`markMarkup()` in [`src/design/icons.ts`](../src/design/icons.ts)).
- **Accent:** iris, `#5338e0` in light and `#a898ff` in dark. It is the one brand color, used for the primary action, the user's own messages, focus rings and category tiles. Green, amber and red appear only as status.
- **Type:** the platform's own UI face, chosen on purpose and loaded with zero bytes. That is SF Pro on Apple devices (SF Pro Rounded for display) and Segoe UI Variable on Windows. Headlines use `font-display` with tight tracking, and prices use tabular figures.
- **Icons:** one 24px grid with 1.75px round strokes, in `src/design/icons.ts`. The card, app, watch and dashboard all use these.
- **Categories:** every post is an **Item** (bag), an **Errand** (a route between two points) or a **Job** (a person with a check). An errand is a service with a pickup, and a job is any other service. `categoryOf()` decides this the same way everywhere.

## Layout of the assistant

- The conversation is the one scrolling region. The latest deal card scrolls into view at full width.
- An empty conversation shows a greeting and four example cards, one per kind of request. They disappear once anything is said.
- **For you** is a dock above the composer. It shows one suggestion at a time, with a pager. The primary action is **Find it** (or **Ask now** when the budget is known), then **Not now**, then a quiet **Forget**. The dock collapses to one row when the user sends a message, and starts as one row on a phone.
- The header holds the mark, the section tabs and two icon buttons. The safety line ("Nothing is agreed until you both confirm…") sits in the deal card's footer and on the sign-in screen. The assistant mode badge appears only on local builds without sign-in.

## Motion

Motion shows what changed and where to look. It never delays an action.

| Moment | Motion |
|---|---|
| A message arrives | rises 8px and fades in (`dur-slow`, `ease-out`) |
| The assistant is thinking | three dots pulse in sequence |
| A card is loading | a skeleton in the card's own shape shimmers. The card rises in once its size is known. |
| The deal is confirmed | the status chip pops (`ease-spring`), and the success check draws itself |
| Switching tabs | the selected pill slides under the new tab, and the panel fades in |
| A new offer arrives | the Deals badge pops |
| Listening | the mic turns red with voice bars and two expanding rings, and the input outline turns red |
| For you opens or closes | its height eases open or closed, and the chevron turns |
| The watch updates | the new line cross-fades in |
| Pressing any button | scales to 0.97 to 0.98 |

With `prefers-reduced-motion: reduce`, every duration token becomes 0ms and each surface also switches animations off.

## Accessibility

- Every text pairing in the token set meets WCAG 2.2 AA in both themes. [`test/design.test.ts`](../test/design.test.ts) checks the pairs listed under `contrast` in the JSON on every `npm test`.
- Focus is a 3px accent outline with an offset, on every control.
- Touch targets are at least 44px. Primary actions are 48px or taller.
- Safe-area insets pad the header, composer and watch face.
- The tabs follow the WAI-ARIA tabs pattern, with arrow keys, Home and End.
- The axe-core WCAG 2.2 AA rules report no violations on the sign-in screen, the assistant (empty and with a card), Deals, My posts, the watch and the dashboard, in light and dark, including inside the card iframes.

| Pair | Needs | Light | Dark |
|---|---|---|---|
| `fg` on `bg` | 4.5:1 | 16.81:1 | 16.73:1 |
| `fg` on `surface` | 4.5:1 | 18.13:1 | 15.42:1 |
| `fg` on `surface-2` | 4.5:1 | 15.86:1 | 13.99:1 |
| `fg-muted` on `bg` | 4.5:1 | 6.13:1 | 7.91:1 |
| `fg-muted` on `surface` | 4.5:1 | 6.62:1 | 7.29:1 |
| `fg-muted` on `surface-2` | 4.5:1 | 5.79:1 | 6.61:1 |
| `accent-fg` on `accent` | 4.5:1 | 6.98:1 | 7.43:1 |
| `accent-fg` on `accent-hover` | 4.5:1 | 8.70:1 | 9.17:1 |
| `accent` on `surface` | 4.5:1 | 6.98:1 | 7.35:1 |
| `accent` on `bg` | 4.5:1 | 6.47:1 | 7.97:1 |
| `accent-ink` on `accent-soft` | 4.5:1 | 7.63:1 | 8.59:1 |
| `good` on `good-soft` | 4.5:1 | 4.76:1 | 7.16:1 |
| `good` on `surface` | 4.5:1 | 5.43:1 | 9.21:1 |
| `warn` on `warn-soft` | 4.5:1 | 5.48:1 | 8.11:1 |
| `warn` on `surface` | 4.5:1 | 6.17:1 | 9.69:1 |
| `danger` on `danger-soft` | 4.5:1 | 5.01:1 | 7.00:1 |
| `danger` on `surface` | 4.5:1 | 5.94:1 | 7.86:1 |
| `danger-fg` on `danger` | 4.5:1 | 5.94:1 | 8.13:1 |
| `line-strong` on `surface` (input borders) | 3:1 | 3.32:1 | 3.97:1 |
| `line-strong` on `bg` | 3:1 | 3.08:1 | 4.31:1 |
| `accent` on `surface-2` (selected controls) | 3:1 | 6.10:1 | 6.67:1 |

## Ring point panel audit

Reviewed against the [Ring UX guide](https://developer.amazon.com/docs/ring/ux-design-guide.html)
on October 20, 2026. The panel uses the public point name, text-labelled arrival
states, a clear next action and a persistent event-retention explanation.
Pending evidence follows the guide's issue → effect → action pattern: waiting
for Ring, press the doorbell/check again, then ask the point operator to check
the connection in the Ring app if it stays pending. Tokens and raw device IDs
stay outside customer-facing cards. The actions have keyboard focus and large
targets; shared tokens have light/dark contrast tests and reduced-motion rules.
Presence corroborates a check-in; this prototype performs no identity verification.
