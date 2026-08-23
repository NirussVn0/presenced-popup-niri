# Task 5 Report — Per-window React roots and cluster bridge

## Status

Implemented Cluster Task 5 on `feat/complete-popup-cluster` from base `ea48a83`.

## Delivered behavior

- `main.tsx` now mounts `WindowRoot`, so each Tauri webview renders only the content for its canonical Rust label.
- `WindowRoot` dispatches all nine labels from `WINDOW_REGISTRY`:
  - `widget-main`
  - `widget-music`
  - `widget-rvc`
  - `widget-lyrics`
  - `widget-system`
  - `widget-countdown`
  - `widget-pomodoro`
  - `widget-quote`
  - `settings`
- Optional windows mount one existing widget inside `WidgetWindowShell`; they do not mount `App` or the complete dashboard tree.
- The quote root is a bounded explicit unavailable state because the current daemon snapshot contract has no quote payload. Unknown labels render a separate explicit bounded unsupported-window state.
- Settings render only in the `settings` root and have an explicit close control backed by the existing `close_window` command.
- `App` no longer imports/composes `SidePanel`, owns `leftOpen`/`rightOpen`, or swaps settings into the main window. Main remains a compact centered Music/RVC/primary-module dashboard.
- Main `<`/`>` controls and matching keyboard keys call `useWindowCluster().toggleSide`, which invokes Rust `set_cluster_visibility`; no in-DOM panel state is used.
- Main exposes cluster loading, error, and degraded states instead of presenting successful initialization/synchronization without evidence.

## Cluster hook

Created `useWindowCluster()` with:

- state: `layout`, `loading`, `error`, `degraded`
- actions: `toggleSide`, `openSettings`, `enterEdit`, `commitEdit`, `cancelEdit`, `hideWidget`

The hook:

1. loads and Zod-validates `/api/settings/widgets` once on mount;
2. invokes `initialize_widget_windows` with that exact layout;
3. subscribes to `/api/events`;
4. accepts only Zod-validated `widget.layout.changed` daemon evidence;
5. applies evidenced layouts through `apply_widget_layout`;
6. persists side, commit, and hide changes through the typed daemon layout endpoint;
7. reports initialization/apply/save failures and reports a disconnected event stream as degraded;
8. intentionally has no polling or fabricated synchronization fallback.

## Small supporting daemon contract

The pre-Task-5 daemon event union could not carry widget layout changes. The smallest truthful bridge was added:

- `DaemonEventSchema` now includes `widget.layout.changed` with `ClusterLayoutV1Schema` payload.
- `PresenceStore.setWidgetLayout` emits that event only after its persistence call succeeds.
- Existing `ApiServer` WebSocket forwarding carries the real store event; no new transport or synthetic timer was added.
- An integration test opens `/api/events`, performs the real validated PUT, and asserts the exact layout event arrives.

Exact limitation: synchronization observes daemon API/store layout writes only. Direct out-of-band database edits do not generate events. If the WebSocket disconnects, the hook visibly degrades and does not poll; the current hook instance must be remounted/reloaded to establish a new subscription.

## Files changed

Created:

- `apps/popup/src/WindowRoot.tsx`
- `apps/popup/src/widgets/WidgetWindowShell.tsx`
- `apps/popup/src/hooks/useWindowCluster.ts`
- `apps/popup/src/__tests__/window-root.test.tsx`

Modified:

- `apps/popup/src/main.tsx`
- `apps/popup/src/App.tsx`
- `packages/contracts/src/events.ts`
- `apps/daemon/src/state/presence-store.ts`
- `apps/daemon/src/__tests__/widget-layout-api.test.ts`

No Rust labels/commands were added or renamed.

## TDD evidence

### Window dispatch RED

```text
pnpm exec vitest run apps/popup/src/__tests__/window-root.test.tsx
exit 1 — Cannot find module ../WindowRoot.js
```

After the initial main/RVC/unknown tracer passed, the all-registry dispatch table failed for the seven unmapped roots. Each label then passed after bounded components were added.

### Layout event RED

```text
pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts
exit 1 — received only state.snapshot; expected widget.layout.changed
```

The same test passed after the typed store event bridge was implemented.

### App/root wiring RED

The focused window-root test then failed because `main.tsx` still mounted `<App />` and `App.tsx` still imported/composed `SidePanel` with `leftOpen`/`rightOpen`. It passed after root dispatch and cluster actions replaced those paths.

## Final verification

Fresh post-edit gate chain:

```text
pnpm --filter @presenced/contracts run build
pnpm exec vitest run apps/popup/src/__tests__/window-root.test.tsx apps/daemon/src/__tests__/widget-layout-api.test.ts
pnpm run typecheck
pnpm exec vitest run --exclude apps/popup/src/__tests__/niri-popup-config.test.ts
pnpm run lint
pnpm run build
```

Results:

- focused Task 5 tests: **23 passed, 0 failed**
- strict workspace typecheck: **passed**
- regression suite excluding one known base failure: **157 passed, 0 failed**
- lint: **passed** (no workspace package currently defines additional lint output)
- full build: **passed** for contracts, core, daemon, popup, and web
- popup production build: **2056 modules transformed**, output generated successfully
- `git diff --check`: **passed**
- tracked `tsconfig.tsbuildinfo` files changed by gates were restored; no generated artifacts remain in the scoped diff.

The required unfiltered `pnpm run test` was also run. It produced **157 passed, 1 failed**. The single failure is the pre-existing stale assertion in `apps/popup/src/__tests__/niri-popup-config.test.ts` that searches `src-tauri/src/lib.rs` for `"center-window"` and `find_niri_window_id`; Task 4 moved that implementation into `window_cluster.rs`. The same inconsistency is present at base `ea48a83` (`lib.rs` lacks the expected text while the test still requires it). It was not changed because Task 5 is intentionally scoped to the React bridge and the smallest required daemon event contract.

## Review notes / concerns

- No live Tauri/Niri multi-window smoke test was run; dispatch, daemon evidence, typecheck, and production bundling are verified, while native window behavior remains covered by Task 4's Rust tests.
- The daemon has no live quote payload, so `widget-quote` truthfully renders unavailable rather than invented content.
- Layout-stream disconnect is visible and non-polling but does not automatically reconnect in this slice.
- The repository-wide full test command remains red only on the confirmed base-stale Task 4 source-location assertion described above.
- No raw titles, credentials, tokens, secrets, or new noisy debug logging were introduced.

## Important review fix round (2026-08-23)

This section supersedes the earlier review concerns and stale full-suite ruling above.

### Fixes delivered

- All optional runtime roots now require real companion snapshot evidence before rendering widget content. Without evidence they render a bounded `data-widget-state="unavailable"` state with the companion error (or an explicit wait-for-validated-snapshot message), so Countdown and Pomodoro cannot present fabricated `Imminent`/zero-day or actionable `25:00` state.
- `WidgetWindowShell` now routes close through `useWindowCluster().hideWidget`. Hide and side visibility persist the canonical daemon layout before native mutation; native failures persist and apply the previous layout as rollback, while successful writes consume their own `widget.layout.changed` echo instead of applying geometry twice.
- Toggle, hide, enter-edit, commit, cancel, daemon-event apply, and their error paths share one promise queue. Commit is persist-then-apply with rollback; cancel updates React state only after native restoration succeeds; `<`/`>` continue to call Rust `set_cluster_visibility`.
- Startup now constructs and opens the event subscription before issuing GET, buffers the latest schema-validated layout event across GET and native initialization, catches events that arrive during initialization with a final ordered apply, and remains loading until socket-open plus native initialization evidence exists.
- Startup GET uses `AbortController`; cleanup marks the hook inactive before closing/aborting, and every post-await native/state transition checks mounted/active state so cleanup cannot initialize or mutate after unmount.
- The Niri integration assertion now inspects `lib.rs` module/handler/setup wiring and current `window_cluster.rs` symbols (`find_niri_windows`, `center_main_window_on_niri`, and `center-window`).
- The daemon WebSocket test now awaits the actual layout frame and socket close instead of sleeping for 80 ms.

### Behavioral regression evidence

New mounted hook/component coverage exercises:

- subscribe-before-fetch startup, loading truth, stale GET versus buffered event, and an even newer event arriving during native initialization;
- valid versus malformed layout frames, exactly-once external apply, degraded disconnect, abort signal propagation, socket cleanup, and no post-unmount initialization;
- persist-before-native toggle/hide ordering, serialized edit enter/commit/cancel, PUT failure with no native mutation, native visibility failure with persisted/native rollback, and self-echo consumption without duplicate `apply_widget_layout`;
- `WidgetWindowShell` close delegation to `hideWidget` and Countdown/Pomodoro unavailable rendering without snapshot evidence.

TDD RED evidence before production fixes:

```text
focused review suite: 11 failed, 25 passed
- Countdown/Pomodoro lacked data-widget-state="unavailable" and rendered Imminent/25:00-like real state.
- WidgetWindowShell invoked hide_widget_window directly; hideWidget spy was never called.
- Startup created no WebSocket before GET.
- toggle/hide invoked native before pending/failed PUT.
- enter/commit/cancel ran concurrently.
- native toggle failure had no daemon/native rollback.
```

### Final verification evidence

```text
pnpm exec vitest run apps/popup/src/__tests__/use-window-cluster.test.tsx apps/popup/src/__tests__/widget-window-shell.test.tsx apps/popup/src/__tests__/window-root.test.tsx apps/popup/src/__tests__/niri-popup-config.test.ts apps/daemon/src/__tests__/widget-layout-api.test.ts
PASS — 5 files, 36 tests

pnpm run typecheck
PASS — contracts, core, daemon, popup, web

pnpm run test
PASS — unfiltered 47 files, 170 tests

pnpm run lint
PASS

pnpm run build
PASS — contracts/core TypeScript, daemon tsup, web Vite (1634 modules), popup Vite (2056 modules)

git diff --check
PASS
```

Generated `tsconfig.tsbuildinfo` changes were restored after gates; no generated build artifacts are included in the scoped diff. No live Tauri/Niri GUI smoke test was run; native behavior remains covered by the reviewed Task 4 Rust implementation plus the behavioral bridge tests above.

## Important review fix round 2 (2026-08-23)

### Multi-root and lifecycle fixes

- `WidgetWindowShell` now uses `useWidgetWindowActions`, a lightweight action-only hook with no mount-time GET, WebSocket subscription, native initialization, or global geometry apply. `useWindowCluster` remains mounted only by the main dashboard and is the sole cluster controller.
- Optional close performs one bounded GET plus one persisted PUT. The daemon's real `widget.layout.changed` event is the only cross-window evidence; the main controller receives it and performs exactly one `apply_widget_layout`. Optional roots do not invoke `hide_widget_window` or apply global geometry.
- Controller actions now capture an `AbortController` when they begin, persistence PUTs receive the signal, cleanup aborts every in-flight action request, and queued operations re-check mount state before execution.
- Toggle, hide, commit, cancel, and settings actions guard at queue entry. Every post-await persistence/native/state transition is guarded. `openSettings` separately guards after lookup and after show so unmount prevents later show/focus work.
- The optional hide queue also guards execution, aborts its in-flight GET/PUT on cleanup, and drops queued hides after unmount.

### Behavioral RED evidence

Before the production refactor:

```text
pnpm exec vitest run apps/popup/src/__tests__/use-window-cluster.test.tsx apps/popup/src/__tests__/widget-window-shell.test.tsx
FAIL — 7 failed, 8 passed
- two optional shells created three cluster WebSockets instead of one;
- queued controller actions persisted after unmount;
- persistence requests carried no abort signal;
- settings showed/focused after unmount;
- optional hide had no lightweight abortable one-shot path;
- WidgetWindowShell still requested the full useWindowCluster hook.
```

### Behavioral coverage added

- Three independently mounted React roots (one main controller plus two optional shells) prove one cluster WebSocket, one startup GET, one `initialize_widget_windows` owner, and no startup `apply_widget_layout` owner duplication.
- An optional close proves exactly one PUT and exactly one main-controller `apply_widget_layout`, including an event delivered before the PUT response, with no `hide_widget_window` race.
- Deterministic deferred tests queue toggle/hide/commit/cancel/openSettings behind an in-flight action, unmount, release the blocker, and prove no subsequent save, native apply, settings lookup, or React layout mutation.
- Additional deferred tests prove in-flight persistence is aborted with no later native/state effect, lookup completion cannot show/focus after unmount, show completion cannot focus after unmount, and an in-flight optional hide plus its queued successor cannot save after cleanup.

### Final verification evidence

```text
pnpm exec vitest run apps/popup/src/__tests__/use-window-cluster.test.tsx apps/popup/src/__tests__/widget-window-shell.test.tsx apps/popup/src/__tests__/window-root.test.tsx apps/popup/src/__tests__/niri-popup-config.test.ts apps/daemon/src/__tests__/widget-layout-api.test.ts
PASS — 5 files, 42 tests

pnpm run typecheck
PASS — contracts, core, daemon, popup, web

pnpm run test
PASS — unfiltered 47 files, 176 tests

pnpm run lint
PASS

pnpm run build
PASS — contracts/core TypeScript, daemon tsup, web Vite (1634 modules), popup Vite (2056 modules)

git diff --check
PASS
```

Generated `tsconfig.tsbuildinfo` changes were restored after gates. The scoped fix contains only the cluster hook, optional shell, behavioral tests, and this report. No live Tauri/Niri GUI smoke test was run and no native runtime claim is made.
