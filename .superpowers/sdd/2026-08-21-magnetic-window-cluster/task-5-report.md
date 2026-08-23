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
