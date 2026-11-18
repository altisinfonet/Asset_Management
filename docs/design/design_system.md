# Asset Tracker Design System (v0.1, draft for founder review)

"Asset Tracker" is a **placeholder product name**. Nothing in this system (tokens, copy, icons) depends on it; a rename touches the login/onboarding copy, the app-shell logo slot and the mobile app name only.

Companion files in this folder:

| File | Purpose |
|---|---|
| `tokens.json` | Machine-readable tokens (W3C Design Tokens format). Source of truth for `packages/ui-tokens`. |
| `wireframes.md` | Screen inventory and low-fi wireframes for M1-M3 (web admin + Expo technician app). |
| `prototype.html` | Clickable low-fi web admin prototype, self-contained, uses the same tokens. |

Scope derived from `02_product_plan.md` (sections 3, 4 M1-M3, 5.3, 6.5) and `03_system_architecture.md` section 3: the **web app** is a Next.js static export (client-rendered, no SSR) for admin/desktop work, including keyboard-wedge / USB scanner input; the **Expo (React Native) app** (`apps/mobile`) is the technician/field app (scan, check-out/in, transfer, stocktake, photos, repair log, loaner pool), online-first with a retry queue. Components are **not** shared between the two (DOM vs React Native); **tokens are** (`packages/ui-tokens`, plan 6.5).

---

## 1. Design principles

Each principle maps to a product principle in plan section 3.

| # | Principle | What it means in the UI | Plan link |
|---|---|---|---|
| D1 | **Fast data entry** | Few clicks, sensible defaults, inline editing in tables, bulk edit everywhere, "save and add another", clone asset, remember last-used category/location per user, forms are single-column and keyboard-navigable (Tab order = visual order), Enter submits, no required field that is not truly required. | P1, P4 |
| D2 | **Scan-first** | Anything that has an identity can be reached by scanning or typing a tag. A wedge/USB scanner "types" into whichever field is focused, so every lookup field accepts a tag plus Enter. Global scan field in the web header (`S` focuses it). On mobile the camera is the home screen. Continuous scan mode, haptic and sound feedback, manual-entry fallback, torch toggle. | P5, M3, 6.5 |
| D3 | **Dense but calm tables** | The asset list is the product. Default 13px text, 36px rows ("comfortable") with a 28px "compact" option, zebra off (hover and selection tint instead), one weight of border, status colour only on the status badge. No more than one saturated colour per row. Column picker, saved views, sticky header and first column, virtualised rows (50k assets, plan P9). | P4, P9 |
| D4 | **Accessible (WCAG 2.2 AA)** | Text >= 4.5:1, UI components and focus >= 3:1 (verified, section 5). Visible focus on everything (2.4.7, 2.4.11/13 focus appearance), target size >= 24x24 on web and >= 44x44 on mobile (2.5.8), no drag-only interactions (2.5.7: every reorder has Move up/down buttons), consistent help and navigation (3.2.6/3.2.3), redundant entry avoided (3.3.7: check-out remembers assignee/date within a flow), accessible authentication (3.3.8: paste allowed in password and TOTP fields, passkeys optional). Colour is never the only signal: badges carry an icon and a text label. Respect `prefers-reduced-motion` and `prefers-contrast`. | P4 |
| D5 | **Keyboard-first admin** | Command palette (`Ctrl/Cmd+K`) for navigation and actions, `/` focuses search, `G then A` go to assets, `C` create, `E` edit, `X` check out, `I` check in, `?` shows the shortcut sheet. Every dialog is focus-trapped, closes on Esc, and returns focus to its trigger. Tables use roving tabindex with arrow-key navigation, Space to select, Shift+arrows to range-select. | P4 |
| D6 | **Light and dark, equal citizens** | Both themes are designed from semantic tokens, not inverted. Default follows `prefers-color-scheme`; user override stored in profile (and `localStorage` as a pre-hydration hint to avoid flash). Status colours are re-tuned per theme so contrast is verified in both. | P4 |
| D7 | **Honest states** | Every list/detail/form defines loading, empty, error and permission-denied states (section 8). Permission-denied never leaks the existence of data ("You do not have access" rather than "Asset 123 exists"). | P8 |
| D8 | **Configurable without code** | Custom fields, status labels, categories render from metadata; the UI never hard-codes a category's fields. | P6 |
| D9 | **Same product, two surfaces** | Web is for configuration, review, bulk work. Mobile is for point-of-contact work. Same vocabulary, same status colours and badge shapes, same tokens, different density. Admin/configuration screens stay web-only (plan 6.5). | 6.5 |
| D10 | **No remote assets** | The Self-hosted edition can be air-gapped: no CDN fonts, no remote icon sets, no analytics scripts in the UI bundle. Fonts and icons are bundled. | 6.15 |

---

## 2. Visual direction (brand-neutral)

- **Tone:** calm, utilitarian, trustworthy: a tool that disappears. Think "well-lit stockroom", not "marketing site".
- **Neutral-first:** greys with a slight cool tint carry 90% of the UI. One accent (primary blue, **placeholder, founder to confirm**) marks the primary action, links, selection and focus. Status colours (green, amber, red, teal-blue) are reserved for state and never decorative.
- **Shape:** 6px radius on controls, 8px on cards/menus, 12px on dialogs/drawers/bottom sheets. 1px borders, shadows only for floating layers (menus, dialogs, toasts, drawers).
- **Imagery:** asset photos and model images are the only imagery; empty states use a single-colour line illustration slot (16:9, 120px tall, optional), not stock art.
- **Logo slot:** 24px mark + wordmark in sidebar; monochrome-capable so it works in both themes.
- **Density:** web default 14px body, 13px in tables; mobile 16px body.
- **Motion:** 100/160/240 ms ease-out only for opacity/transform of overlays and row highlight; none otherwise; all disabled under `prefers-reduced-motion`.

---

## 3. Foundations

All values live in `tokens.json`; the tables below are the human-readable view.

### 3.1 Typography

Font stack: `Inter` if bundled locally, else the system UI font (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, ...`). Mono (`JetBrains Mono`, falling back to `ui-monospace`) is used for **asset tags, serial numbers and scan codes** so characters like 0/O and 1/l/I are distinguishable and tags align in columns. Use `font-variant-numeric: tabular-nums` for money, quantities and dates.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `font.size.xs` | 12 / 16 | 500 | Badges, captions, table meta, keyboard hints |
| `font.size.sm` | 13 / 20 | 400 | Dense table cells, helper text, tab labels |
| `font.size.base` | 14 / 20 | 400 (500 for labels) | Web body, form labels, buttons, menu items |
| `font.size.md` | 16 / 24 | 400 | Mobile body, **all mobile and responsive-web inputs** (prevents iOS zoom) |
| `font.size.lg` | 18 / 26 | 600 | Card/section title, mobile card title |
| `font.size.xl` | 20 / 28 | 600 | Web page title |
| `font.size.2xl` | 24 / 32 | 600 | Mobile screen title, large page title, empty-state title |
| `font.size.3xl` | 30 / 38 | 600 | Login / onboarding headline |

Rules: max two weights per screen (400 and 600; 500 for labels); line length <= 72ch for prose; never use all-caps for more than a short label (`xs`, +0.04em tracking, used only for table-column group headers); support 200% text zoom (1.4.4) and text-spacing overrides (1.4.12) without clipping, so controls use min-height, not fixed height.

### 3.2 Spacing

4px base unit. Scale (`space.*`): 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px.

- Component inner padding: 8 (dense) / 12 (default) / 16 (cards).
- Gap between form fields: 16. Between form sections: 32.
- Page gutter: 24 (>= lg), 16 (< md). Content max width 1440 for tables, 720 for forms/settings.
- Table cell padding: 8 x 12 (comfortable), 4 x 12 (compact).

Sizes (`size.*`): web control height 36 (dense 28), mobile touch target 44 (primary action 52), icon 16/20/24, sidebar 232 (collapsed 56), drawer 480.

### 3.3 Radii

`sm` 4 (badges, checkboxes), `md` 6 (inputs, buttons), `lg` 8 (cards, popovers, menus), `xl` 12 (dialogs, drawers, bottom sheets top corners), `full` (pills, avatars, switches).

### 3.4 Elevation

Flat by default; elevation only communicates "floats above the page".

| Level | Token | Use | Light | Dark |
|---|---|---|---|---|
| 0 | none | Page, cards, tables (1px `border`) | none | none |
| 1 | `shadow.sm` | Sticky table header, segmented controls, mobile cards | subtle | stronger (dark needs more opacity) |
| 2 | `shadow.md` | Dropdowns, popovers, command-palette results, toasts | | |
| 3 | `shadow.lg` | Dialogs, drawers, bottom sheets | | |

In dark mode a floating layer also uses the lighter `sunken`/`surface` step plus the shadow, because shadows are less visible on dark backgrounds. Scrim: `color.*.scrim` at 50% (light) / 60% (dark).

### 3.5 Breakpoints and layout

`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Below `lg` the sidebar becomes an off-canvas drawer and tables switch to a "card list" with the 3 most important columns; drawers become full-height sheets. The web app is fully responsive (plan 5.3) but the Expo app is the recommended phone experience.

### 3.6 Iconography

**Lucide** (`lucide-react` on web, `lucide-react-native` on mobile; ISC licence, tree-shaken, bundled, no remote loading). 1.5px stroke, 16/20/24 px. Icons accompany text in navigation and buttons; icon-only buttons require a visible tooltip and an `aria-label`. Suggested mapping:

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| Assets | `package` | Check out | `log-out` / `arrow-up-right` |
| Locations | `map-pin` / `building-2` | Check in | `log-in` / `arrow-down-left` |
| Categories | `tags` | Loaner pool | `repeat` / `clock` |
| Models | `layers` | Repair | `wrench` |
| Custom fields | `sliders-horizontal` | Stocktake | `clipboard-check` |
| Status labels | `circle-dot` | Scan | `scan-line` / `qr-code` |
| Labels | `printer` / `qr-code` | Import | `upload` |
| Accessories / consumables | `cable` / `box` | History | `history` |
| Search / palette | `search` / `command` | Attachments | `paperclip` |
| Users | `users` | Warning / error | `triangle-alert` / `circle-x` |
| Settings | `settings` | Success / info | `circle-check` / `info` |
| Offline / retry | `wifi-off` / `refresh-cw` | Lock (permission) | `lock` |

Status badges always pair an icon with the label (never colour alone): ready `circle-check`, assigned `user`, in repair `wrench`, lost `circle-help`, disposed `archive`, overdue `clock-alert` (or `clock`).

---

## 4. Colour roles

Semantic tokens only; components never reference raw hex. Tokens exist for **light** and **dark** under `color.light.*` / `color.dark.*` in `tokens.json` and become CSS variables `--color-*` (web) and a theme object (mobile).

| Role | Token(s) | Purpose |
|---|---|---|
| bg | `bg` | App canvas behind everything |
| surface | `surface` | Cards, tables, inputs, dialogs, drawers, popovers |
| sunken | `sunken` | Table header, hover row, wells, code/tag chips, disabled input fill |
| text | `text` | Primary text |
| muted | `muted` | Secondary text, placeholder, helper text, table meta (still >= 4.5:1, so safe for real content) |
| border | `border` | Decorative separators and card outlines |
| border-strong | `border-strong` | Boundaries of interactive controls (input, checkbox, radio, switch off-state): >= 3:1 |
| primary | `primary.solid`, `.hover`, `.on`, `.subtle`, `.text` | Primary button fill, selected state, links |
| success | `success.solid`, `.on`, `.subtle`, `.text` | Ready / completed / in stock |
| warning | `warning.solid`, `.on`, `.subtle`, `.text` | Due soon, low stock, in repair, variance |
| danger | `danger.solid`, `.on`, `.subtle`, `.text` | Overdue, lost, errors, destructive actions |
| info | `info.solid`, `.on`, `.subtle`, `.text` | Neutral notices, loaned, dry-run info |
| focus | `focus` | Focus ring: 2px, 2px offset |

Sub-role meaning: `solid` = filled backgrounds, icons and borders; `on` = text/icon on `solid`; `subtle` = badge/banner background; `text` = coloured text (on `bg`, `surface`, `sunken` or its own `subtle`).

**Fixed state types to colour mapping** (plan 5.3: status labels are configurable names mapped to fixed state types):

| State type | Colour role | Icon |
|---|---|---|
| Ready / deployable | success | circle-check |
| Assigned / checked out | primary | user |
| In repair / maintenance | warning | wrench |
| Lost / missing | danger | circle-help |
| Archived / disposed | neutral (`sunken` + `muted`) | archive |
| Overdue (derived) | danger | clock |
| Loaned / on loan (derived) | info | repeat |

Admins rename labels (e.g. "Deployed", "Out for fix") but cannot change the state type's colour in MVP (keeps contrast guarantees); custom colours are a post-MVP option that must pass a contrast check at save time.

---

## 5. Contrast verification (computed)

Method: WCAG 2.x relative luminance and contrast ratio, computed by `scratchpad/contrast.js` reading `tokens.json` directly (so it cannot drift from the tokens). Thresholds: **text pairs >= 4.5:1; UI components, focus ring and graphical objects >= 3:1** (1.4.3, 1.4.11). Pairs checked per mode: `text`, `muted`, `primary.text` and each status `.text` on `bg`, `surface` and `sunken`; each role's `.on` on `.solid`; each role's `.text`, `text` and `muted` on its `.subtle`; `border-strong`, `focus` and each `.solid` against `bg`/`surface`/`sunken`; `.solid` and `focus` on `.subtle`.

**Result: 146 pairs checked, 0 failures. Lowest ratio 3.35:1 (light `border-strong` on `sunken`, a 3:1 UI pair). Lowest text-pair ratio: 6.31:1 (dark `muted` on `primary.subtle`), well above 4.5:1.**

Key pairs (full 146-row table in Appendix A):

| Pair | Light | Dark | Req. |
|---|---|---|---|
| `text` on `bg` | 16.71 | 15.97 | 4.5 |
| `text` on `surface` | 17.92 | 14.73 | 4.5 |
| `text` on `sunken` | 15.56 | 13.31 | 4.5 |
| `muted` on `bg` | 7.21 | 8.47 | 4.5 |
| `muted` on `surface` | 7.73 | 7.81 | 4.5 |
| `muted` on `sunken` | 6.72 | 7.05 | 4.5 |
| `primary.text` on `surface` | 8.53 | 9.05 | 4.5 |
| `primary.on` on `primary.solid` (button) | 6.23 | 7.47 | 4.5 |
| `primary.on` on `primary.hover` | 7.90 | 8.97 | 4.5 |
| `success.text` on `success.subtle` (badge) | 6.70 | 8.26 | 4.5 |
| `warning.text` on `warning.subtle` (badge) | 7.58 | 8.55 | 4.5 |
| `danger.text` on `danger.subtle` (badge) | 6.86 | 7.94 | 4.5 |
| `info.text` on `info.subtle` (badge) | 6.92 | 8.06 | 4.5 |
| `primary.text` on `primary.subtle` (selected row/nav) | 7.28 | 7.31 | 4.5 |
| `text` on `primary.subtle` (selected row) | 15.29 | 11.90 | 4.5 |
| `success/warning/danger/info.on` on `.solid` (solid buttons/banners) | 5.38 / 5.46 / 5.90 / 5.67 | 7.84 / 8.60 / 6.38 / 7.86 | 4.5 |
| `border-strong` on `surface` (input outline) | 3.85 | 4.75 | 3 |
| `border-strong` on `bg` | 3.60 | 5.15 | 3 |
| `border-strong` on `sunken` | 3.35 | 4.29 | 3 |
| `focus` on `surface` | 6.65 | 7.98 | 3 |
| `focus` on `bg` | 6.21 | 8.65 | 3 |
| `focus` on `sunken` | 5.78 | 7.21 | 3 |
| `focus` on `primary.subtle` (selected row) | 5.68 | 6.45 | 3 |
| `primary.solid` on `surface` (switch on, icons) | 6.23 | 7.00 | 3 |
| status `.solid` on `surface` (icons, progress) | 5.38 to 5.90 | 5.73 to 8.02 | 3 |

Design notes from the verification:
- The focus ring uses a 2px offset gap painted in the page background, so the ring is never adjacent to a `primary.solid` fill (the one pair that would fail); it is checked against `bg`, `surface`, `sunken` and every `.subtle`.
- `border` (decorative) is intentionally lower contrast than 3:1 (rows, card outlines); **interactive control boundaries use `border-strong`**. Never place a control whose only visible edge is `border`.
- Disabled controls are exempt from contrast (1.4.3) but still use `muted` text on `sunken` (6.7+:1) with a `not-allowed` cursor and `aria-disabled`, so they remain legible.
- Placeholder text uses `muted` (4.5:1 verified), but placeholders never replace labels.
- Text over photos (asset images) always sits on a `scrim`-backed chip, never directly on the image.

To re-run: `node contrast.js ../path/to/tokens.json` (script kept in the session scratchpad; it can be committed under `packages/ui-tokens/scripts/` and run in CI so a token change that breaks contrast fails the build, recommended).

---

## 6. Web component inventory

Target stack (section 9): Next.js static export, Tailwind CSS v4, shadcn/ui (Radix primitives), TanStack Table + TanStack Virtual, react-hook-form + zod (`packages/schemas`), cmdk. Each row lists the build basis.

| # | Component | Description and behaviour | Basis |
|---|---|---|---|
| W1 | **App shell** | Left sidebar (232px, collapsible to 56px icon rail), top bar (breadcrumbs, global scan/search field, command-palette hint, "+ New" menu, notifications, user menu), content area with max width. Skip-link to main content. Landmarks: `header`, `nav`, `main`. | shadcn Sidebar, Radix |
| W2 | **Sidebar nav** | Sections: Assets, Locations, Loaner pool, Repairs, Stocktakes, Labels, Import, Reports (v2 placeholder), Settings. Active item uses `primary.subtle` + `primary.text` + 3px leading bar and `aria-current="page"`. Badges for counts (overdue loaners). Collapsible groups. Settings has its own sub-nav. | custom on Radix |
| W3 | **Data table** | Virtualised; sticky header and first column; sortable (multi-sort with Shift); resizable and reorderable columns (with keyboard alternative); row selection with bulk action bar; inline cell edit (status, location, assignee); density toggle (comfortable 36 / compact 28); column-pinning; footer with "n of N" and page size or infinite scroll; roving-tabindex keyboard model; "select all matching filter" for bulk operations; CSV/XLSX export of current view. | TanStack Table v8 + Virtual |
| W4 | **Column picker** | Popover with searchable checklist of columns (including every custom field), drag handle plus Move up/down buttons (WCAG 2.5.7), "Reset to default". | Radix Popover + cmdk |
| W5 | **Saved views** | Named combos of filters, sort, columns, density; personal or shared (permission: Asset Manager+); tabs row above the table (`All assets`, `My checked-out`, `Overdue`, `In repair`, `+`); unsaved-changes indicator with Save / Save as / Revert. Deep-linkable (view encoded in URL). | custom |
| W6 | **Filter bar** | Chips-based filter builder: `Field - operator - value`; field types drive operators (text contains/equals, select is/is not any of, date before/after/between/relative, number range, checkbox is, user/location pickers, tag exact match). Quick-filter chips for status; free-text search (tag/serial exact-match first, plan 6.7). Active filters are removable chips; "Clear all". | custom on Radix Popover |
| W7 | **Command palette** | `Ctrl/Cmd+K`. Groups: Go to (pages), Actions (create asset, check out asset, import CSV, print labels), Assets (live search by tag, serial, name; exact tag match ranked first, under 200 ms), Recent. Typing a full tag then Enter opens the asset. Shows shortcut hints. | cmdk |
| W8 | **Form primitives** | Text, textarea, number (with unit), currency, date picker (typed entry + calendar), select/combobox (searchable, async for users/locations/models), multi-select, checkbox, radio, switch, URL, file. Label above input, helper text below, error text with icon and `aria-describedby`, required marked with text "(required)" not just an asterisk. Inline validation on blur, summary at top on submit failure with links to fields (3.3.1/3.3.3). | shadcn Form + react-hook-form + zod |
| W9 | **Custom-field renderer** | Given a category's field definitions (type text/number/date/select/multi-select/checkbox/URL, required, help text, default, options, validation), renders the correct input in forms, the correct read-only display in detail, the correct cell renderer and filter operator in tables, and the correct import-mapping target. Grouped under a "Fields for <category>" section; switching category in a form shows/hides fields and warns before discarding entered values. Unknown/removed fields render read-only with a "field removed" hint. | custom (one registry: `type -> {Input, Display, Cell, Filter, Schema}`) |
| W10 | **Status badge** | Pill (`radius.sm`/`full`), icon + label, colour by state type (section 4), 12px/500; variants: dot-only (dense) with tooltip, never colour-only. Also used for derived "Overdue" and "On loan". | custom |
| W11 | **Detail drawer** | Right-side drawer (480px, `radius.xl` leading corners, `shadow.lg`) for quick view from the table: key fields, status, assignee, primary actions, "Open full page". Esc closes, focus returns to the row. Also hosts quick edit and the repair-log entry form. | Radix Dialog (modal=false) / Sheet |
| W12 | **Dialog** | Modal (check-out/in, confirm destructive, bulk edit, move location). Title, description, content, footer with primary on the right, Esc closes, focus trap, `aria-modal`. Destructive confirm requires typing the count or name for bulk irreversible actions. Max width 520 (forms 640). | Radix AlertDialog / Dialog |
| W13 | **Toast** | Bottom-right (top on mobile web), 5s auto-dismiss (persist when an action is offered, e.g. "Undo"), `role="status"` (polite) / `role="alert"` for errors, pause on hover/focus, dismiss button; stacking max 3. Never the only place an error appears. | Sonner / Radix Toast |
| W14 | **Empty state** | Title, one sentence on why, primary action, optional secondary (Import CSV), 16:9 illustration slot. Variants: first-use, no-results (with "Clear filters"), cleared-by-filter, no-permission. | custom |
| W15 | **File upload** | Dropzone + button (keyboard operable), multi-file, per-file progress and cancel, type/size limits stated up-front, thumbnail for images, states: queued, uploading, **scanning** (virus scan pending, plan 6.6), ready, rejected (infected/too large/unsupported) with reason and retry. Presigned PUT directly to storage. Clipboard paste of images. | custom + Uppy-like logic |
| W16 | **QR label preview** | Live preview of the label sheet: template selector (a few fixed Avery-style sheet templates in MVP), paper size, start position (to reuse partly-used sheets), copies, what prints (QR + tag + name + location), a single-label zoom, "Download PDF". Preview matches print output (mm-accurate, CSS `mm` units), QR has a quiet zone and error-correction level M; also shows a Code128 variant toggle. | custom (`qrcode`, `jsbarcode`, PDF in worker) |
| W17 | **Tabs** | Detail page tabs: Overview (including custom fields), History, Repairs, Attachments, and Licenses (v1), with count badges; keyboard arrows between tabs, tab state in URL. | Radix Tabs |
| W18 | **Timeline** | Chain-of-custody and audit history: event icon, who/what/when (relative time with absolute in tooltip), from-to values, notes, photos; filter by event type. | custom |
| W19 | **Tree** | Location hierarchy (company > site > building > room): expand/collapse, keyboard arrows (WAI-ARIA tree), inline add child, move via "Move to..." dialog (and optional drag), asset counts. | Radix Collapsible / custom treegrid |
| W20 | **Banner / callout** | Page-level info/warning/danger/success with icon, title, text, action; e.g. "License band 85% used", "Server is read-only". `role="status"`/`alert`. | custom |
| W21 | **Stepper / wizard** | Onboarding and CSV import: numbered steps, back/next, progress saved, each step reachable via URL. | custom |
| W22 | **Import review table** | Dry-run results: row-level status (will create / will update / skipped duplicate / error), grouped counts, filter to errors, download error report CSV, expandable row diff. | custom on W3 |
| W23 | **Scan input** | Single field that accepts typed text or wedge/USB scanner input (detects rapid keystrokes + Enter), shows last-scanned result inline, auditory and visual confirmation; used in header, check-in/out dialogs and stocktake. Web camera scan (Should): opens a camera sheet using BarcodeDetector with ZXing fallback. | custom |
| W24 | **Menu / popover / tooltip / avatar / pagination / skeleton / progress / switch / breadcrumbs / kbd** | Standard primitives. | shadcn/Radix |

**Select sizes and variants (W8, used by W3).** `Select` takes `size` (`md` default, 36px `--size-control`; `sm`, 28px `--size-control-dense`, `px-2`, 13px text) and `variant` (`outline` default; `ghost`). Forms and filter bars use `md` + `outline`. **Inline table select: `sm` + `ghost`** (for example the Role column on Settings, Users and roles). A ghost select has no border or fill at rest, so rows are not boxed in; the muted chevron (7.7 : 1 on `surface`, 6.7 : 1 on `sunken`, light; 7.8 / 7.1 dark) keeps it identifiable as a control. On hover it gains `border-strong` and the `sunken` fill, on keyboard focus the standard 2px focus ring, and when disabled it has no hover affordance. The 28px control sits centred in a 36px comfortable row; in a compact (28px) table the `DataTable` exposes `data-density="compact"` and the select drops to 24px (`in-data-[density=compact]:min-h-6`) so the row never grows. A ghost select is only for table cells, where the row and the chevron supply the affordance; a control outside a table must keep a `border-strong` edge (section 5 note). To line the value text up with the column header, give the select `-ml-2` (cancels its own `px-2`). Tab strips (`TabsList`) scroll horizontally on overflow with `overflow-y-hidden`, so a 1px underline overlap never produces a vertical scrollbar.

---

## 7. Mobile (Expo) component inventory

React Native components, one `theme` object generated from `tokens.json`, fonts via `expo-font` bundled (no remote), icons via `lucide-react-native`, gestures via `react-native-gesture-handler`, bottom sheets via `@gorhom/bottom-sheet`. Minimum touch target 44pt (primary actions 52pt); body 16px; supports Dynamic Type / Android font scaling up to 200%; VoiceOver/TalkBack labels on every control; haptic feedback on scan result.

| # | Component | Description and behaviour |
|---|---|---|
| M1 | **Scanner view** | Full-screen camera (`expo-camera`; qr, code128, datamatrix), reticle, torch toggle, "Enter tag manually" button, mode switch (Lookup / Check-out / Check-in / Stocktake), continuous-scan toggle (stocktake), result toast + haptic + sound; permission-needed state with explanation and "Open settings"; low-light hint. Never auto-submits a state change from a scan alone (scan only resolves; the action needs a confirm tap, except continuous stocktake confirm which is reversible). |
| M2 | **Asset card** | Compact card: photo thumbnail (56px), name, tag (mono), status badge, location, assignee, due date (with overdue emphasis), and 1-2 primary actions. Used in lookup results, stocktake lists, loaner pool, search results. Full-card tap opens detail. |
| M3 | **Asset quick view (sheet/screen)** | Header (photo, tag, status), key fields, custom fields (collapsible), recent history (3 events), action row: Check out / Check in / Transfer / Photo / Repair / More. Actions shown depend on state and role (server returns `allowed actions`, architecture 6.a). |
| M4 | **Check-out sheet** | Bottom sheet: assignee type segmented control (Person / Location / Asset), searchable picker with recent assignees, expected return (date with presets: today, +1 day, +1 week, end of term), notes, optional photo, bulk summary when multiple assets; primary 52pt "Check out" button; success state with "Undo" for 10s and "Scan next". Idempotency key generated on open so a retry never double-posts. |
| M5 | **Stocktake list** | Session header (name, location, progress ring "42 of 120"), tabs: Expected / Found / Missing / Unexpected, per-item row with swipe-free large buttons (Found / Missing), "scan to confirm" continuous mode, unexpected item prompt (add to session or ignore), finish with variance summary. Survives app backgrounding (state persisted). |
| M6 | **Offline / retry banner** | Persistent top banner when the network fails: "No connection. 2 actions waiting to send" with Retry now and "View queue"; states: offline (warning), retrying (info, spinner), sent (success, auto-dismiss), failed (danger, with item and reason). MVP is online-first with a retry queue; the full "unsynced items" UI and conflict resolution arrive with offline-first in v2 (plan 6.5). Uses `refresh-cw`/`wifi-off`, `accessibilityLiveRegion="polite"`. |
| M7 | **Photo capture** | Camera/gallery sheet, retake, compress client-side (<= 2 MP), upload progress per photo, queued when offline. |
| M8 | **Server connect screen** | First launch: enter server URL or scan setup QR; MDM managed config presets it (plan 6.5). Shows trust errors in plain language (TLS). |
| M9 | **Loaner pool list** | Cards with due date and overdue chip, "Quick check-out" and "Bulk check-in" (select many by scanning). |
| M10 | **Repair log form** | Date, description, cost, photo attachments, resulting status. |
| M11 | Bottom tab bar, list rows, segmented control, pickers, search field, toast/snackbar, empty/error/skeleton states | Standard; mirrors web semantics and tokens. |

---

## 8. States (applies to every screen)

| State | Pattern | Accessibility |
|---|---|---|
| **Loading** | Skeleton matching final layout (table rows, detail header, cards); no spinner-only screens > 300 ms; button-level spinner with label kept ("Checking out..."); progress bar for imports/uploads with count and ETA; keep previous data visible while refetching (dim 60%). | `aria-busy`, polite live region announces "Loaded 50 assets". |
| **Empty** | First use: explain + primary action + secondary (Import CSV / Add sample data). Filtered-empty: "No assets match these filters" + Clear filters. Zero results of search: suggest checking the tag, search all fields. | Heading + action focusable. |
| **Error** | Inline for fields; banner for page-load failure with Retry and a support-friendly request ID; toast only for transient failures; network failure on mobile uses the offline/retry banner; never blame the user; keep entered data. 409/stale ETag: "This asset changed. Reload to see the latest" with diff. 429: wait message. | `role="alert"` for errors; focus moved to error summary on submit. |
| **Permission-denied** | Hidden vs disabled rule: hide navigation to modules the role can never use; show disabled-with-tooltip ("Only Asset Managers can do this") for actions on otherwise visible screens; direct URL to a forbidden page shows a 403 screen ("You do not have access to this. Ask an admin for the Asset Manager role." + link home) without revealing whether the record exists; location-scoped users see only their locations (counts respect scope). | Tooltip content also in `aria-describedby`. |
| **Read-only / licence** | Self-hosted read-only mode (licence expired past grace, decision 26): persistent warning banner, edit controls disabled with explanation, export always enabled. | |
| **Success** | Toast with undo where reversible, then return to the originating list with the row highlighted for 2s. | Live region. |
| **Dry-run / preview** | Distinct "Preview, nothing saved yet" banner (info) on import and bulk-edit previews. | |

---

## 9. Recommended libraries

**Web (`apps/web`, Next.js static export):**
- Tailwind CSS v4 (CSS-first config; tokens exposed as CSS variables in `@theme`, light/dark via `[data-theme]` and `prefers-color-scheme`), Radix UI primitives via shadcn/ui (copy-in components, so no runtime lock-in and fully themeable with our tokens), `class-variance-authority`, `tailwind-merge`.
- TanStack Table v8 + TanStack Virtual (data table), cmdk (command palette), react-hook-form + `@hookform/resolvers` + zod (shared `packages/schemas`), TanStack Query (client-side fetching with `packages/api-client`), Sonner (toasts), `lucide-react`, `date-fns`, `qrcode` + `jsbarcode` (labels), `@zxing/browser` (camera fallback, lazy-loaded), `next-themes`-style tiny theme script (inline, to avoid theme flash in a static export), `react-aria`'s `useDateField` or shadcn calendar (`react-day-picker`) for dates.
- Quality: Storybook (component states in light and dark), `eslint-plugin-jsx-a11y`, axe-core in Playwright, `@axe-core/react` in dev, visual regression (Playwright screenshots) for tables and dialogs, Lighthouse CI for performance budgets (plan P9).
- All bundled assets only (no CDN) for the Self-hosted edition.

**Mobile (`apps/mobile`, Expo SDK 58):**
- React Native core components, `expo-camera`, `expo-secure-store`, `expo-haptics`, `expo-image`, `expo-font`, `lucide-react-native`, `@gorhom/bottom-sheet`, `react-native-gesture-handler` / `reanimated`, TanStack Query + `packages/api-client`, `packages/schemas`, React Navigation or Expo Router.
- Styling: a thin `theme.ts` + `useTheme()` generated from `packages/ui-tokens` (StyleSheet), or NativeWind v4 if the team wants Tailwind class parity with web; either way **tokens are the only shared artefact**, not components (plan 6.5). Prefer plain StyleSheet + tokens for the MVP (fewer moving parts with Expo upgrades).
- Quality: `@testing-library/react-native`, Maestro for e2e scan flows, manual device matrix for qr/code128/datamatrix scanning (plan 6.5).

**`packages/ui-tokens` build:** read `tokens.json` (Style Dictionary v4 or a ~100-line script) -> emits `tokens.css` (`:root` and `[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` variables), `tailwind-theme.css` (`@theme` block), `tokens.ts` (typed object for React Native), and runs the contrast script as a unit test.

---

## 10. Accessibility checklist (release gate for each screen)

1. Tab through the whole screen: visible focus on every element, logical order, no traps (except modal traps with Esc).
2. All actions available by keyboard; shortcuts do not fire inside inputs and can be disabled (2.1.4).
3. Inputs have programmatically associated labels; errors identified in text, linked via `aria-describedby`; summary on submit.
4. Contrast checked from tokens; custom colours (future) blocked unless passing.
5. Colour is never the sole indicator (icons/labels on status; underline links in body copy).
6. Table semantics: `table`/`grid` roles, column headers, `aria-sort`, selected rows `aria-selected`; announce selection counts.
7. Dialog/drawer: labelled, focus moved in and restored; background inert.
8. Reduced motion, 200% zoom and 320px reflow without 2-D scrolling (except data tables, which scroll in a labelled region; 1.4.10 exception) all work.
9. Targets: >= 24x24 CSS px web, >= 44pt mobile; no drag-only actions.
10. Screen-reader pass: NVDA/Windows (web), VoiceOver (macOS/iOS), TalkBack (Android) on login, asset list, check-out, stocktake before beta.
11. Scanner: audio and haptic feedback have visual equivalents; manual entry always available.

---

## 11. Design decisions (2026-11-17)

**Decided (founder accepted):**
- **Theme:** follow the OS theme (`prefers-color-scheme`) with a manual light/dark override stored in the user profile (D6, section 3).
- **Web density:** as proposed. 14px body, 13px table cells, 36px comfortable rows, 28px compact option (sections 2 and 3.1 to 3.2).
- **Row click:** opens the 480px detail drawer (W11). Enter opens the full asset page.
- **Mobile home:** the Scan screen (M1, section 7).
- **Status colours:** fixed per state type (section 4). Admins rename labels but do not recolour them in MVP.
- **Icons:** Lucide, bundled, no remote loading (section 3.6).
- **Font:** Inter bundled locally, with the system UI font as fallback. JetBrains Mono (falling back to `ui-monospace`) for asset tags, serial numbers and scan codes (section 3.1).
- **Shared code:** only design tokens are shared between web and mobile. No shared components (section 9).
- **Mobile styling:** plain StyleSheet plus shared tokens for MVP; no NativeWind (section 9).
- **Loaner pool:** a top-level sidebar item (W2, section 6).

**Deferred (placeholders kept):**
- **Product name:** "Asset Tracker" (placeholder, see the note at the top of this file).
- **Primary colour:** blue placeholder `#2A55D6` (light) and `#7AA2FF` (dark) (sections 2 and 4, Appendix A).
- **Brand visuals:** logo (section 2 logo slot), empty-state illustrations (section 2) and tone of voice (section 2).
- **Decide before M3 store testing.** All names come from one config, so a rename is a small change.

---

## Appendix A. Full contrast table (generated)

Generated by `contrast.js` from `tokens.json` (146 pairs, 0 failures).

### light
| Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|
| text #14171F | bg #F6F7F9 | 16.71:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | bg #F6F7F9 | 7.21:1 | 4.5:1 (text) | PASS |
| primary.text #1E43AD | bg #F6F7F9 | 7.96:1 | 4.5:1 (text) | PASS |
| success.text #0F6035 | bg #F6F7F9 | 7.14:1 | 4.5:1 (text) | PASS |
| warning.text #7A3B05 | bg #F6F7F9 | 7.98:1 | 4.5:1 (text) | PASS |
| danger.text #9C1C22 | bg #F6F7F9 | 7.53:1 | 4.5:1 (text) | PASS |
| info.text #085777 | bg #F6F7F9 | 7.42:1 | 4.5:1 (text) | PASS |
| border-strong #7A8294 | bg #F6F7F9 | 3.60:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | bg #F6F7F9 | 6.21:1 | 3:1 (UI) | PASS |
| primary.solid #2A55D6 | bg #F6F7F9 | 5.82:1 | 3:1 (UI) | PASS |
| success.solid #157A45 | bg #F6F7F9 | 5.02:1 | 3:1 (UI) | PASS |
| warning.solid #A8510A | bg #F6F7F9 | 5.09:1 | 3:1 (UI) | PASS |
| danger.solid #C0262D | bg #F6F7F9 | 5.51:1 | 3:1 (UI) | PASS |
| info.solid #0B6E99 | bg #F6F7F9 | 5.29:1 | 3:1 (UI) | PASS |
| text #14171F | surface #FFFFFF | 17.92:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | surface #FFFFFF | 7.73:1 | 4.5:1 (text) | PASS |
| primary.text #1E43AD | surface #FFFFFF | 8.53:1 | 4.5:1 (text) | PASS |
| success.text #0F6035 | surface #FFFFFF | 7.65:1 | 4.5:1 (text) | PASS |
| warning.text #7A3B05 | surface #FFFFFF | 8.55:1 | 4.5:1 (text) | PASS |
| danger.text #9C1C22 | surface #FFFFFF | 8.07:1 | 4.5:1 (text) | PASS |
| info.text #085777 | surface #FFFFFF | 7.95:1 | 4.5:1 (text) | PASS |
| border-strong #7A8294 | surface #FFFFFF | 3.85:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | surface #FFFFFF | 6.65:1 | 3:1 (UI) | PASS |
| primary.solid #2A55D6 | surface #FFFFFF | 6.23:1 | 3:1 (UI) | PASS |
| success.solid #157A45 | surface #FFFFFF | 5.38:1 | 3:1 (UI) | PASS |
| warning.solid #A8510A | surface #FFFFFF | 5.46:1 | 3:1 (UI) | PASS |
| danger.solid #C0262D | surface #FFFFFF | 5.90:1 | 3:1 (UI) | PASS |
| info.solid #0B6E99 | surface #FFFFFF | 5.67:1 | 3:1 (UI) | PASS |
| text #14171F | sunken #EDEFF3 | 15.56:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | sunken #EDEFF3 | 6.72:1 | 4.5:1 (text) | PASS |
| primary.text #1E43AD | sunken #EDEFF3 | 7.41:1 | 4.5:1 (text) | PASS |
| success.text #0F6035 | sunken #EDEFF3 | 6.65:1 | 4.5:1 (text) | PASS |
| warning.text #7A3B05 | sunken #EDEFF3 | 7.43:1 | 4.5:1 (text) | PASS |
| danger.text #9C1C22 | sunken #EDEFF3 | 7.01:1 | 4.5:1 (text) | PASS |
| info.text #085777 | sunken #EDEFF3 | 6.91:1 | 4.5:1 (text) | PASS |
| border-strong #7A8294 | sunken #EDEFF3 | 3.35:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | sunken #EDEFF3 | 5.78:1 | 3:1 (UI) | PASS |
| primary.solid #2A55D6 | sunken #EDEFF3 | 5.41:1 | 3:1 (UI) | PASS |
| success.solid #157A45 | sunken #EDEFF3 | 4.68:1 | 3:1 (UI) | PASS |
| warning.solid #A8510A | sunken #EDEFF3 | 4.74:1 | 3:1 (UI) | PASS |
| danger.solid #C0262D | sunken #EDEFF3 | 5.13:1 | 3:1 (UI) | PASS |
| info.solid #0B6E99 | sunken #EDEFF3 | 4.92:1 | 3:1 (UI) | PASS |
| primary.on #FFFFFF | primary.solid #2A55D6 | 6.23:1 | 4.5:1 (text) | PASS |
| primary.text #1E43AD | primary.subtle #E7EDFC | 7.28:1 | 4.5:1 (text) | PASS |
| text #14171F | primary.subtle #E7EDFC | 15.29:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | primary.subtle #E7EDFC | 6.60:1 | 4.5:1 (text) | PASS |
| primary.solid #2A55D6 | primary.subtle #E7EDFC | 5.32:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | primary.subtle #E7EDFC | 5.68:1 | 3:1 (UI) | PASS |
| success.on #FFFFFF | success.solid #157A45 | 5.38:1 | 4.5:1 (text) | PASS |
| success.text #0F6035 | success.subtle #E3F4EA | 6.70:1 | 4.5:1 (text) | PASS |
| text #14171F | success.subtle #E3F4EA | 15.69:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | success.subtle #E3F4EA | 6.77:1 | 4.5:1 (text) | PASS |
| success.solid #157A45 | success.subtle #E3F4EA | 4.71:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | success.subtle #E3F4EA | 5.83:1 | 3:1 (UI) | PASS |
| warning.on #FFFFFF | warning.solid #A8510A | 5.46:1 | 4.5:1 (text) | PASS |
| warning.text #7A3B05 | warning.subtle #FDF0D5 | 7.58:1 | 4.5:1 (text) | PASS |
| text #14171F | warning.subtle #FDF0D5 | 15.87:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | warning.subtle #FDF0D5 | 6.85:1 | 4.5:1 (text) | PASS |
| warning.solid #A8510A | warning.subtle #FDF0D5 | 4.84:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | warning.subtle #FDF0D5 | 5.89:1 | 3:1 (UI) | PASS |
| danger.on #FFFFFF | danger.solid #C0262D | 5.90:1 | 4.5:1 (text) | PASS |
| danger.text #9C1C22 | danger.subtle #FCE8E8 | 6.86:1 | 4.5:1 (text) | PASS |
| text #14171F | danger.subtle #FCE8E8 | 15.23:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | danger.subtle #FCE8E8 | 6.57:1 | 4.5:1 (text) | PASS |
| danger.solid #C0262D | danger.subtle #FCE8E8 | 5.02:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | danger.subtle #FCE8E8 | 5.65:1 | 3:1 (UI) | PASS |
| info.on #FFFFFF | info.solid #0B6E99 | 5.67:1 | 4.5:1 (text) | PASS |
| info.text #085777 | info.subtle #E1F2F9 | 6.92:1 | 4.5:1 (text) | PASS |
| text #14171F | info.subtle #E1F2F9 | 15.59:1 | 4.5:1 (text) | PASS |
| muted #4A5365 | info.subtle #E1F2F9 | 6.73:1 | 4.5:1 (text) | PASS |
| info.solid #0B6E99 | info.subtle #E1F2F9 | 4.93:1 | 3:1 (UI) | PASS |
| focus #1B4FD8 | info.subtle #E1F2F9 | 5.79:1 | 3:1 (UI) | PASS |
| primary.on #FFFFFF | primary.hover #2147B8 | 7.90:1 | 4.5:1 (text) | PASS |

### dark
| Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|
| text #E9ECF2 | bg #0E1117 | 15.97:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | bg #0E1117 | 8.47:1 | 4.5:1 (text) | PASS |
| primary.text #9DBAFF | bg #0E1117 | 9.81:1 | 4.5:1 (text) | PASS |
| success.text #6FD9A3 | bg #0E1117 | 10.92:1 | 4.5:1 (text) | PASS |
| warning.text #F2C068 | bg #0E1117 | 11.26:1 | 4.5:1 (text) | PASS |
| danger.text #FF9A9F | bg #0E1117 | 9.34:1 | 4.5:1 (text) | PASS |
| info.text #82CDEE | bg #0E1117 | 10.72:1 | 4.5:1 (text) | PASS |
| border-strong #7C8699 | bg #0E1117 | 5.15:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | bg #0E1117 | 8.65:1 | 3:1 (UI) | PASS |
| primary.solid #7AA2FF | bg #0E1117 | 7.59:1 | 3:1 (UI) | PASS |
| success.solid #3DBE82 | bg #0E1117 | 8.00:1 | 3:1 (UI) | PASS |
| warning.solid #E8A23A | bg #0E1117 | 8.69:1 | 3:1 (UI) | PASS |
| danger.solid #F0686E | bg #0E1117 | 6.22:1 | 3:1 (UI) | PASS |
| info.solid #4DB6E3 | bg #0E1117 | 8.20:1 | 3:1 (UI) | PASS |
| text #E9ECF2 | surface #161A22 | 14.73:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | surface #161A22 | 7.81:1 | 4.5:1 (text) | PASS |
| primary.text #9DBAFF | surface #161A22 | 9.05:1 | 4.5:1 (text) | PASS |
| success.text #6FD9A3 | surface #161A22 | 10.07:1 | 4.5:1 (text) | PASS |
| warning.text #F2C068 | surface #161A22 | 10.39:1 | 4.5:1 (text) | PASS |
| danger.text #FF9A9F | surface #161A22 | 8.61:1 | 4.5:1 (text) | PASS |
| info.text #82CDEE | surface #161A22 | 9.89:1 | 4.5:1 (text) | PASS |
| border-strong #7C8699 | surface #161A22 | 4.75:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | surface #161A22 | 7.98:1 | 3:1 (UI) | PASS |
| primary.solid #7AA2FF | surface #161A22 | 7.00:1 | 3:1 (UI) | PASS |
| success.solid #3DBE82 | surface #161A22 | 7.37:1 | 3:1 (UI) | PASS |
| warning.solid #E8A23A | surface #161A22 | 8.02:1 | 3:1 (UI) | PASS |
| danger.solid #F0686E | surface #161A22 | 5.73:1 | 3:1 (UI) | PASS |
| info.solid #4DB6E3 | surface #161A22 | 7.57:1 | 3:1 (UI) | PASS |
| text #E9ECF2 | sunken #1E232D | 13.31:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | sunken #1E232D | 7.05:1 | 4.5:1 (text) | PASS |
| primary.text #9DBAFF | sunken #1E232D | 8.17:1 | 4.5:1 (text) | PASS |
| success.text #6FD9A3 | sunken #1E232D | 9.10:1 | 4.5:1 (text) | PASS |
| warning.text #F2C068 | sunken #1E232D | 9.39:1 | 4.5:1 (text) | PASS |
| danger.text #FF9A9F | sunken #1E232D | 7.78:1 | 4.5:1 (text) | PASS |
| info.text #82CDEE | sunken #1E232D | 8.94:1 | 4.5:1 (text) | PASS |
| border-strong #7C8699 | sunken #1E232D | 4.29:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | sunken #1E232D | 7.21:1 | 3:1 (UI) | PASS |
| primary.solid #7AA2FF | sunken #1E232D | 6.33:1 | 3:1 (UI) | PASS |
| success.solid #3DBE82 | sunken #1E232D | 6.66:1 | 3:1 (UI) | PASS |
| warning.solid #E8A23A | sunken #1E232D | 7.24:1 | 3:1 (UI) | PASS |
| danger.solid #F0686E | sunken #1E232D | 5.18:1 | 3:1 (UI) | PASS |
| info.solid #4DB6E3 | sunken #1E232D | 6.84:1 | 3:1 (UI) | PASS |
| primary.on #0A1228 | primary.solid #7AA2FF | 7.47:1 | 4.5:1 (text) | PASS |
| primary.text #9DBAFF | primary.subtle #1B2A4F | 7.31:1 | 4.5:1 (text) | PASS |
| text #E9ECF2 | primary.subtle #1B2A4F | 11.90:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | primary.subtle #1B2A4F | 6.31:1 | 4.5:1 (text) | PASS |
| primary.solid #7AA2FF | primary.subtle #1B2A4F | 5.66:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | primary.subtle #1B2A4F | 6.45:1 | 3:1 (UI) | PASS |
| success.on #04170E | success.solid #3DBE82 | 7.84:1 | 4.5:1 (text) | PASS |
| success.text #6FD9A3 | success.subtle #12301F | 8.26:1 | 4.5:1 (text) | PASS |
| text #E9ECF2 | success.subtle #12301F | 12.09:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | success.subtle #12301F | 6.41:1 | 4.5:1 (text) | PASS |
| success.solid #3DBE82 | success.subtle #12301F | 6.05:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | success.subtle #12301F | 6.55:1 | 3:1 (UI) | PASS |
| warning.on #1C1000 | warning.solid #E8A23A | 8.60:1 | 4.5:1 (text) | PASS |
| warning.text #F2C068 | warning.subtle #38270B | 8.55:1 | 4.5:1 (text) | PASS |
| text #E9ECF2 | warning.subtle #38270B | 12.13:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | warning.subtle #38270B | 6.43:1 | 4.5:1 (text) | PASS |
| warning.solid #E8A23A | warning.subtle #38270B | 6.60:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | warning.subtle #38270B | 6.57:1 | 3:1 (UI) | PASS |
| danger.on #1F0507 | danger.solid #F0686E | 6.38:1 | 4.5:1 (text) | PASS |
| danger.text #FF9A9F | danger.subtle #3B1518 | 7.94:1 | 4.5:1 (text) | PASS |
| text #E9ECF2 | danger.subtle #3B1518 | 13.58:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | danger.subtle #3B1518 | 7.20:1 | 4.5:1 (text) | PASS |
| danger.solid #F0686E | danger.subtle #3B1518 | 5.29:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | danger.subtle #3B1518 | 7.36:1 | 3:1 (UI) | PASS |
| info.on #041823 | info.solid #4DB6E3 | 7.86:1 | 4.5:1 (text) | PASS |
| info.text #82CDEE | info.subtle #0F2E3D | 8.06:1 | 4.5:1 (text) | PASS |
| text #E9ECF2 | info.subtle #0F2E3D | 12.00:1 | 4.5:1 (text) | PASS |
| muted #A5AEBF | info.subtle #0F2E3D | 6.36:1 | 4.5:1 (text) | PASS |
| info.solid #4DB6E3 | info.subtle #0F2E3D | 6.17:1 | 3:1 (UI) | PASS |
| focus #8CAEFF | info.subtle #0F2E3D | 6.50:1 | 3:1 (UI) | PASS |
| primary.on #0A1228 | primary.hover #93B3FF | 8.97:1 | 4.5:1 (text) | PASS |

PAIRS: 146  FAILURES: 0  LOWEST: 3.35 (light border-strong on sunken)
