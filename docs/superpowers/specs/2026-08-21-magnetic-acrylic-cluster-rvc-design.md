# Magnetic Acrylic Cluster & RVC Studio — Design Specification

**Product:** presenced-popup-niri
**Target release:** v0.7
**Date:** 2026-08-21
**Status:** Approved concept; written-spec review required before implementation planning

## 1. Product intent

presenced-popup-niri will behave as a local-first Niri widget cluster rather than a conventional desktop application. One mandatory dashboard window remains centered. Every optional widget is a separate Tauri window which magnetically attaches to deterministic slots around the dashboard. Discord Rich Presence is the primary configurable output and receives a complete, typed editor rather than the current display-only approximation.

The visual direction follows the supplied reference: a luminous frosted acrylic shell, dark translucent content modules, large radii, restrained controls, and clear depth between outer glass and inner surfaces.

## 2. Goals

1. Keep a 720×420 main dashboard anchored at the center of the focused Niri output.
2. Give each optional widget an independent frameless Tauri window.
3. Magnetically snap widget windows to stable slots around the main dashboard.
4. Permit drag, reorder, and preset resize only while Edit mode is active.
5. Toggle all left or right widget windows with `<` and `>` without moving the main dashboard.
6. Ship Acrylic Sage as the default theme with presets and manual tuning.
7. Replace the mismatched RVC frontend/backend model with one validated contract.
8. Support real custom Rich Presence text, rotation, templates, activity type, images, timestamps, quotes, and exact outgoing-payload inspection.
9. Preserve privacy, bounded Discord updates, reconnect behavior, and zero selfbot/user-token behavior.

## 3. Non-goals for v0.7

- Mutating Discord Custom Status or using a Discord user token.
- Uploading assets to the Discord Developer Portal automatically.
- Accepting local file paths as Discord image assets. Images must use an uploaded asset key or HTTPS URL.
- Replacing the desktop wallpaper or implementing the wallpaper browser shown in the reference image.
- Automatic wallpaper color extraction. v0.7 uses presets plus manual tint controls.
- Fullscreen-game auto-hide policy. The window model must leave a clean integration seam, but game-mode automation is a later slice.
- Arbitrary freeform widget placement in normal mode.

## 4. Window architecture

### 4.1 Window inventory

| Window label | Required | Default size | Role |
| --- | --- | --- | --- |
| `widget-main` | yes | 720×420 | centered dashboard and cluster controller UI |
| `widget-music` | optional | 250×190 | detailed media, vinyl, waveform, controls |
| `widget-rvc` | optional | 250×190 | exact outgoing Discord activity and rotation state |
| `widget-lyrics` | optional | 250×240 | synchronized lyrics |
| `widget-system` | optional | 220×150 | CPU, RAM, uptime, battery |
| `widget-countdown` | optional | 220×140 | selected countdown |
| `widget-pomodoro` | optional | 220×220 | focus timer and controls |
| `widget-quote` | optional | 250×150 | active quote and source |
| `settings` | on demand | 820×680 | complete configuration surface |

All windows are transparent, frameless, skip the taskbar, and use the same process. The main window is the anchor. Closing the main window closes every widget window and exits the process. Closing an optional widget hides only that widget. Closing Settings hides Settings and returns focus to the main dashboard.

### 4.2 Niri identity and discovery

Every window receives a unique title and Tauri label. Niri window discovery matches the tuple:

```text
process PID + exact window title/label
```

PID alone is insufficient once several windows share one process. The Rust coordinator maps each Tauri label to a Niri window ID, and refreshes the map after a window is recreated or Niri reconnects.

### 4.3 Main anchor

`widget-main` is always opened floating at 720×420. The existing bounded Niri startup placement remains responsible for centering it after WebKit/Niri opening configuration settles. Optional windows never modify the main window size or position.

On output/workspace changes, the coordinator re-reads the main and optional window positions from one Niri snapshot and reapplies the slot projection. Relative calculations use the main position from the same snapshot, avoiding instability from Niri workspace-view scrolling offsets.

### 4.4 Magnetic slots

Slots are logical positions relative to the main dashboard, not persisted screen pixels.

```text
left:  L1, L2, L3... outward from main
right: R1, R2, R3... outward from main
vertical lane positions: top, middle, bottom
cluster gap: 10 px
snap threshold: 24 px
```

The canonical placement model is:

```ts
type WidgetWindowId =
  | "music"
  | "rvc"
  | "lyrics"
  | "system"
  | "countdown"
  | "pomodoro"
  | "quote";

type WidgetSide = "left" | "right";
type WidgetSizePreset = "compact" | "standard" | "tall" | "wide";

interface WidgetPlacement {
  widgetId: WidgetWindowId;
  side: WidgetSide;
  order: number;
  lane: "top" | "middle" | "bottom";
  size: WidgetSizePreset;
  visible: boolean;
}

interface ClusterLayoutV1 {
  version: 1;
  leftVisible: boolean;
  rightVisible: boolean;
  placements: WidgetPlacement[];
}
```

No overlapping placements are valid. Dropping a widget into an occupied slot inserts it and shifts the existing widget plus all later widgets outward. The projection is a pure deterministic function with bounds and collision tests.

### 4.5 Edit mode

Normal mode locks every optional window. Content controls remain interactive but drag and resize handles are absent.

Pencil/Edit mode:

- Shows a drag grip and resize preset control on every widget window.
- Allows native window dragging.
- Reads final positions on drag end and resolves the nearest valid slot.
- Snaps when within 24 px of a slot or neighboring widget edge.
- Uses insertion semantics to push occupied slots outward.
- Shows a ghost slot before drop.
- Persists only when the user presses **Done**.
- **Cancel** restores the prior committed layout.

Widget resizing is preset-based. Arbitrary pixel resizing is excluded to prevent broken internal layouts.

### 4.6 Cluster toggles

- `<` toggles all windows assigned to the left cluster.
- `>` toggles all windows assigned to the right cluster.
- Hidden windows use Tauri `hide`; they are not destroyed.
- Reopening restores state and reapplies slot geometry.
- The main dashboard remains centered and unchanged.

## 5. Visual system

### 5.1 Acrylic Sage default

Each widget window is its own rounded acrylic surface.

Outer surface tokens:

```css
--acrylic-tint: 126 153 74;
--acrylic-opacity: 0.48;
--acrylic-blur: 30px;
--acrylic-saturation: 1.15;
--acrylic-border: rgb(255 255 255 / 0.10);
--acrylic-radius: 24px;
--acrylic-shadow: 0 18px 50px rgb(0 0 0 / 0.34);
```

Inner module tokens:

```css
--module-bg: rgb(7 11 12 / 0.78);
--module-blur: 16px;
--module-border: rgb(255 255 255 / 0.06);
--module-radius: 18px;
--module-text: rgb(244 247 244 / 0.95);
--module-muted: rgb(214 221 214 / 0.62);
```

The outer surface is luminous and wallpaper-aware through transparency. Inner modules are darker and quieter for readability. The design must not collapse both layers into identical dark panels.

### 5.2 Theme controls

Theme Settings exposes:

- Preset: Acrylic Sage, Frost Blue, Neon Violet, Warm Amber, Rose Smoke.
- Manual tint color.
- Outer opacity.
- Backdrop blur.
- Saturation.
- Inner-module darkness.
- Border strength.
- Glow strength.
- Clock style.

Changes broadcast to every WebView through a shared theme channel. A last-known local cache allows default rendering if the daemon is unavailable; canonical settings persist through the daemon settings store.

### 5.3 Component hierarchy

Main dashboard:

1. Identity/clock header and controls.
2. Compact Music module only when media exists.
3. Compact outgoing RVC module.
4. One selected primary module: Lyrics, Pomodoro, or Countdown.

Optional windows contain the expanded form of one widget only. Widget windows do not scroll. Their content adapts to the declared size preset. Settings is the only normal scroll surface.

## 6. RVC domain contract

### 6.1 Existing defect

The current frontend writes `type` and `customText`, while the daemon reads `scene` and `customActivity`. The API stores unvalidated arrays and does not guarantee immediate scheduler reconfiguration. This creates settings that appear editable but do not reliably affect Discord output.

v0.7 replaces both models with schemas in `packages/contracts` and performs a migration from legacy stored data.

### 6.2 Canonical configuration

```ts
type RvcMode = "auto" | "music" | "custom" | "quote" | "pomodoro";
type DiscordActivityType = "playing" | "listening" | "watching";
type TimestampMode = "none" | "elapsed" | "remaining" | "media";

interface RvcButton {
  label: string;
  url: string;
}

interface RvcActivityTemplate {
  activityType: DiscordActivityType;
  detailsTemplate?: string;
  stateTemplate?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  timestampMode: TimestampMode;
  buttons: RvcButton[];
}

interface RvcEntry {
  id: string;
  enabled: boolean;
  mode: RvcMode;
  label: string;
  durationSec: number;
  template: RvcActivityTemplate;
  quoteFile?: string;
}

interface RvcConfigV2 {
  version: 2;
  enabled: boolean;
  minPublishIntervalSec: number;
  entries: RvcEntry[];
}
```

Only one Discord activity exists at a time. Rotation is sequential, not simultaneous.

### 6.3 Template variables

Supported variables are explicit and mode-aware:

```text
{track} {artist} {album} {lyric}
{quote}
{app} {category}
{pomodoroTask} {pomodoroRemaining}
{countdownTitle} {countdownRemaining}
{elapsed}
```

Unknown variables are validation errors in the editor. Missing runtime values render an explicit configured fallback or suppress the field; they never publish raw window titles by default.

### 6.4 Assets

`largeImage` and `smallImage` accept:

1. A Discord Developer Portal asset key.
2. An external HTTPS image URL.

Discord's current Rich Presence documentation supports both forms. External URLs must be HTTPS, 1–300 characters, and pass URL validation. Local filesystem paths and automatic Developer Portal uploads are rejected. Hover text is bounded to Discord field limits.

The UI shows whether a value is interpreted as an asset key or URL, renders a local preview when possible, and shows Discord rejection without pretending it was published.

### 6.5 Buttons

Up to two buttons are allowed. Each requires a non-empty label and valid HTTPS URL. Buttons are omitted when unsupported by the connected client or rejected by the RPC response. The runtime surfaces this as a degraded entry error rather than silently claiming success.

### 6.6 Validation and rate control

- Entry duration: 15–3600 seconds.
- Global minimum publish interval: at least 15 seconds.
- Details/state and hover text use Discord-compatible bounds.
- At most two buttons.
- URLs must be HTTPS.
- Empty activities are rejected.
- Track changes are event-driven and coalesced; position ticks do not publish Discord updates.
- Quote files are loaded once, cached, and refreshed only when file identity/config changes.

## 7. Scheduler and runtime state

Saving RVC config performs one typed operation:

1. Parse with Zod.
2. Migrate legacy config if required.
3. Persist to SQLite.
4. Atomically update the live scheduler.
5. Broadcast new config/runtime state over WebSocket.

No daemon restart is required.

The daemon exposes:

```ts
interface RvcRuntimeState {
  enabled: boolean;
  connected: boolean;
  activeEntryId: string | null;
  activeMode: RvcMode | null;
  activeSince: number | null;
  nextRotationAt: number | null;
  lastPublishedAt: number | null;
  lastPayload: DiscordActivity | null;
  lastError: { code: string; message: string; at: number } | null;
}
```

`RvcWidget` renders this exact runtime state, not a guessed label from the resolved presence.

## 8. RVC Studio UI

Settings opens as a separate 820×680 window. Tabs:

1. Layout
2. Widgets
3. RVC Studio
4. Theme
5. Quotes
6. Discord
7. About/Credits

RVC Studio contains:

- Global enabled switch and publish interval.
- Ordered entry list with drag reorder.
- Add Auto, Music, Custom, Quote, or Pomodoro entry.
- Per-entry enable, duration, duplicate, and delete.
- Activity type selector.
- Details/state template editor with variable insertion.
- Large/small image key-or-URL editor and preview.
- Hover text fields.
- Timestamp mode.
- Up to two buttons.
- Quote source selector when mode is Quote.
- Exact JSON payload preview.
- Discord-style visual preview.
- **Test now** action that publishes a validated temporary payload without changing rotation order.
- **Save & Apply** with explicit success/error feedback.

## 9. Optional RVC widget

The independent RVC window displays:

- Discord connection state.
- Active entry and mode.
- Exact outgoing `details` and `state`.
- Asset preview.
- Next rotation countdown.
- Last publish time.
- Last RPC rejection/error.

This is the status "q.note" surface. It must never show Connected as proof that a payload was accepted; connection and publication are separate states.

## 10. API design

```text
GET  /api/settings/widgets
PUT  /api/settings/widgets
GET  /api/settings/theme
PUT  /api/settings/theme
GET  /api/settings/rvc
PUT  /api/settings/rvc
POST /api/settings/rvc/test
GET  /api/rvc/runtime
```

Writes use validated explicit payloads. Errors include stable reason codes. Runtime state is also part of the WebSocket snapshot so all windows stay synchronized.

## 11. Degraded and error behavior

- Daemon unavailable: main remains visible with cached theme; optional runtime widgets show unavailable and no fake activity.
- Niri IPC unavailable: main stays a normal Tauri fallback window; side windows remain hidden with a visible integration error.
- Discord disconnected: editor remains usable; Test now reports unavailable.
- Discord rejects payload: retain last accepted payload and expose rejection details.
- Invalid asset URL/key: block Save/Test for that entry.
- Output removed or scale changed: hide optional windows, recompute slots around main, then restore visible clusters.
- Slot overflow: hide outward-most widgets and expose the exact overflow count in Layout Settings.

## 12. Persistence and migration

- Layout schema: `ClusterLayoutV1` in daemon settings storage.
- RVC schema: `RvcConfigV2` in daemon settings storage.
- Theme schema gains Acrylic tokens and a version.
- Migrations are pure, tested, and preserve recognizable legacy entries.
- Unmigratable entries are disabled with a visible reason; they are not discarded silently.
- Defaults create only the centered main dashboard. Every optional expanded widget window starts hidden and is enabled explicitly in the first-run tutorial or Settings, avoiding duplicate Music/RVC surfaces.

## 13. Privacy and security

- No Discord user token, selfbot, or Custom Status mutation.
- No raw window titles in default templates.
- No shell commands from WebViews.
- Rust exposes bounded typed commands for window cluster actions.
- Niri subprocess arguments are fixed or numeric IDs, never raw user strings.
- Quote paths are constrained to the bundled daemon quotes directory and `$XDG_DATA_HOME/presenced/quotes`; arbitrary filesystem paths are rejected.
- External asset preview fetches are HTTPS-only and bounded.

## 14. Testing strategy

### Pure model tests

- Slot derivation on both sides.
- Magnetic threshold and nearest-slot selection.
- Occupied-slot insertion and outward push.
- Collision prevention and output bounds.
- Layout migration and serialization.
- RVC schema validation and legacy migration.
- Template expansion and privacy fallbacks.
- Scheduler order, duration, coalescing, and rate limit.

### Component tests

- Acrylic token application.
- Widget size-preset layouts without scroll.
- RVC editor fields and validation.
- Exact outgoing payload preview.
- Connection vs publication status distinction.

### Runtime tests

- Main geometry unchanged while left/right clusters toggle.
- Every widget is an independent Niri floating window.
- Edit-only drag/resize behavior.
- Magnetic snap and push after native drag.
- Two-output reprojection.
- Settings opens independently and does not resize main.
- Graceful close without allocator or WebKit errors.
- Discord config applies without daemon restart.
- Test now reports accepted/rejected truthfully.

### Visual acceptance

At minimum capture and inspect:

- Acrylic Sage main-only state.
- Main plus left cluster.
- Main plus both clusters.
- RVC Studio entry editor and preview.
- Theme presets.
- Reduced motion.
- 1920×1080 at scale 1 and one scaled output.

## 15. Acceptance criteria

1. Main dashboard remains centered at 720×420 through cluster toggles.
2. Every optional widget is a distinct Tauri/Niri window.
3. Optional windows never cover the main dashboard in committed layout.
4. `<` and `>` toggle whole left/right clusters without resizing main.
5. Edit mode is the only state permitting move/resize.
6. Magnetic insert/push produces no overlaps and persists on Done.
7. Acrylic Sage matches the reference hierarchy: luminous outer glass and dark inner modules.
8. Theme settings apply to every window immediately.
9. Custom RVC text, modes, assets, timestamps, rotation, and quotes change the actual Discord payload.
10. RVC widget and Studio show the exact last accepted payload and any rejection.
11. RVC changes apply live without daemon restart.
12. Full TypeScript, Rust, unit, integration, Tauri build, Niri runtime, and independent review gates pass.

## 16. Delivery slices

1. **Cluster foundation:** multi-window registry, Rust/Niri mapping, slots, hide/show, persistence.
2. **Edit and magnetism:** drag lock, slot projection, insertion/push, size presets.
3. **Acrylic visual system:** tokens, presets, cross-window broadcast, widget variants.
4. **RVC contract and scheduler:** schemas, migration, API, atomic live update, runtime state.
5. **RVC Studio and widget:** editor, assets, preview, Test now, outgoing status window.
6. **Integrated QA:** dual-output runtime, Discord acceptance, visual review, release build and docs.

Each slice must be user-visible, tested, and independently reviewed before the next slice is called complete.
