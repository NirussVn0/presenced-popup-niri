# Task 6 Report — Edit mode, magnetic insertion, and Layout Settings

## Scope delivered

Implemented only magnetic Cluster Task 6 on `feat/complete-popup-cluster` from base `8538100`.

- `useWindowCluster` now owns a real `EditSession` with immutable committed/candidate layouts and a dirty flag.
- Candidate side, order, lane, size, visibility, reset, hide, and drag changes do not persist before Done.
- Cancel applies the committed layout and clears the edit transaction.
- Done writes one canonical daemon PUT and performs one `apply_widget_layout` call on the successful path; the existing expected-echo mechanism prevents duplicate event-backed applies.
- Layout Settings uses fixed side/order/lane/size/visible controls, main-only reset, and a geometry-backed overflow count. It has no free width/height inputs.
- The settings webview uses an action/state-only Tauri event bridge. The main dashboard remains the only `useWindowCluster` controller; optional/settings roots do not create a daemon WebSocket, startup GET, or global lifecycle owner.
- Optional widget shells expose drag and fixed-preset resize controls only while edit mode is active.
- Rust adds bounded plain-payload geometry commands. Drag completion performs one bounded `niri msg --json windows` snapshot and validates the exact PID/title dragged and main rectangles plus output bounds before returning them.
- TypeScript projects candidate slots, chooses the nearest valid slot, inserts and pushes occupied orders, applies the snapped candidate natively, and restores committed edit-mode geometry for invalid, out-of-bounds, capture-failed, or apply-failed drops.
- Tutorial defaults to main-only. Finish writes one deterministic valid layout for explicitly checked windows; Skip writes the main-only layout and marks the tutorial seen only after the action succeeds.

## RED evidence

Before production implementation, focused tests failed for the intended missing behavior:

```text
pnpm exec vitest run \
  apps/popup/src/__tests__/window-cluster-layout.test.ts \
  apps/popup/src/__tests__/use-window-cluster.test.tsx \
  apps/popup/src/__tests__/widget-window-shell.test.tsx \
  apps/popup/src/__tests__/layout-settings.test.tsx

exit 1 — 9 failed / 25 passed
- missing snapDraggedPlacement/resetCandidateLayout/createTutorialLayout
- missing EditSession/updatePlacement/completeDrag
- missing edit-only shell affordances
- missing LayoutSettings module
```

```text
cargo test drag_snapshot -- --nocapture
exit 101 — unresolved import drag_snapshot_from_payload
```

Independent OpenCode review then found two deterministic gaps: settings-first overflow had no geometry, and rejected drag restored native state without reconciling a previously dirty candidate. Remediation tests were run RED before fixes:

```text
vitest -t "computes settings-driven|rejects an out-of-bounds"
exit 1 — 2 failed
```

A follow-up review found capture failure discarded known geometry. Its regression test was also observed RED:

```text
vitest -t "retains known geometry"
exit 1 — expected overflow 1, received 0
```

## GREEN evidence

Focused behavior passed after implementation and review fixes:

- popup hook focused suite: **20 passed**
- Task 6 pure/component focused suite before review additions: **38 passed**
- Rust unit suite: **17 passed**
- popup strict typecheck: passed

Final gates on the finished tree:

```text
pnpm run typecheck
passed — contracts, core, daemon, popup, web

pnpm run test
passed — 48 files, 192 tests

pnpm run lint
passed

cargo test
passed — 17 Rust tests plus doc tests

cargo fmt --all -- --check
passed

cargo clippy --all-targets --all-features -- -D warnings
passed

pnpm run build
passed — popup 2058 modules transformed; daemon/web/popup production outputs generated

git diff --check
passed
```

Tracked `tsconfig.tsbuildinfo` files changed by typecheck/build were restored. Generated `dist`, `target`, and dependency directories remain ignored and are not part of the candidate diff.

## Deterministic coverage added

- normal versus edit-only drag/resize affordances;
- committed/candidate/dirty session state and no pre-Done PUT;
- occupied-slot insertion and outward order push;
- Cancel committed-geometry restoration;
- exactly one successful Done PUT and one native geometry apply;
- fixed size presets and absence of numeric width/height inputs;
- reset and geometry-backed overflow count before any drag;
- successful snap/apply, out-of-bounds rejection, candidate reconciliation, and capture-failure geometry retention;
- Rust plain drag/main/output serialization and malformed/missing/duplicate/zero-sized rejection;
- tutorial explicit finish selection and main-only skip.

## Review and concerns

- An independent OpenCode review reported the overflow/candidate-reconciliation issues above; both were fixed with RED/GREEN tests. A follow-up review confirmed both fixes and exposed the stale-geometry regression, which was also fixed and tested. A final read-only review of the staged geometry/candidate fix returned **PASS** with no remaining blocking Task 6 correctness issue.
- The production popup build retains the existing Rollup warning that the main minified chunk is slightly above 500 kB. Build succeeds.
- React test renderer emits its existing deprecation warning; all assertions pass.

## Native acceptance status

**LIVE NIRI ACCEPTANCE PENDING.**

No claim is made that live drag lock, visual snap animation, push, Cancel, Done, output switch, or no-overlap behavior has been accepted on a running Niri session. Those GUI checks must be performed separately against the exact committed candidate SHA. Deterministic TypeScript/component/Rust seams and all requested local gates are green.

## Independent-review fix round 1

Addressed all findings reported against `4eb1ba0`.

### Drag completion contract and fail-closed behavior

- `beginDrag` now prepares a one-use Rust drag token and validated origin snapshot before native drag begins.
- The optional window registers Tauri `onMoved` before `startDragging`, requires actual move-event evidence followed by a 180 ms quiet settle, and imposes a 2500 ms total completion deadline.
- Completion waits for both `startDragging()` and move-settle evidence. A deferred-start regression test was observed RED when the implementation used `Promise.race`, then GREEN after switching to `Promise.all`; `complete_widget_drag` cannot run while `startDragging` remains pending.
- Only the main controller consumes the positive safe-integer token and requests the final Niri snapshot. Rust consumes the token exactly once, requires the exact widget/PID/title, rejects no movement, rejects main/output changes, and validates dragged/main containment within nonzero output bounds.
- Timeout, edit cancellation, root unmount, snapshot failure, invalid geometry, no movement, and snap-apply failure all fail closed through token cancellation and committed edit-geometry rollback. Successful rollback and tutorial seen-marker failure behavior now have deterministic coverage.

### Stable action bridge

- The main `cluster-layout-action` listener now registers exactly once for its mount lifetime.
- Current action callbacks and overflow state are read through stable refs; size cycling computes from candidate state inside the serialized operation queue rather than at event receipt.
- A Tauri event-bus integration test drives overflow, settings, request-state, and rapid widget size actions across rerenders; it proves one listener registration and no lost/stale action.

### Fully bounded Niri subprocess helper

- `run_niri_command` now delegates to one complete bounded helper with a 1500 ms wall-clock deadline, reserved cleanup budget, nonblocking stdout/stderr draining, and independent 1 MiB byte caps.
- Each child starts in its own process group. Timeout, output overflow, read/wait failure, or inherited held pipe handles trigger process-group `SIGKILL`, bounded direct-child reaping, and fail-closed error return; there are no reader-thread joins.
- Rust tests exercise the complete helper for timeout, oversized stdout, oversized stderr, inherited/held pipes, direct-child kill/reap, and successful bounded JSON/stderr capture.

### RED evidence for this round

```text
vitest use-window-cluster.test.tsx
exit 1 — 2 intended failures:
- beginDrag had no prepare/onMoved completion handshake
- action listener registered twice after overflow change

vitest -t "waits for native move completion"
exit 1 — snapshot ran while deferred startDragging remained pending

cargo test --no-run
exit 101 — missing run_command_with_limits, validate_completed_drag, and libc
```

### Final verified gates

```text
focused TS suites
2 files / 30 tests passed

pnpm run typecheck
passed — contracts, core, daemon, popup, web

pnpm run test
passed — 48 files / 198 tests

pnpm run lint
passed

cargo test
passed — 21 Rust tests plus doc tests

cargo fmt --all -- --check
passed

cargo clippy --all-targets --all-features -- -D warnings
passed

pnpm run build
passed — popup 2058 modules transformed
(existing >500 kB Rollup chunk warning only)

git diff --check
passed
```

Tracked `tsconfig.tsbuildinfo` artifacts were restored after the final build. Added-line security scan found no hardcoded-secret, shell-injection, eval/exec, or unsafe-deserialization matches. Independent OpenCode follow-up review returned **PASS** with no Critical/Important issue remaining in drag ordering, listener lifetime/current-state access, or subprocess bounds.

**LIVE NIRI ACCEPTANCE REMAINS PENDING.** No live-runtime claim is added in this fix round; exact-build GUI acceptance remains required after commit.

## Critical drag-release fix round 2

Addressed the sole remaining scoped Critical finding against `0b79fca` without changing the approved stable action-listener or bounded Niri subprocess paths.

### Authoritative Linux release evidence

- Removed the 180 ms `onMoved` quiet/settle heuristic and all related tests.
- Grounded the replacement in the locked Linux stack: Tauri `2.11.5`, Tao `0.35.3`, GTK `0.18.2`, and GDK `0.18.2`. Tao's Linux `DragWindow` path calls GTK `begin_move_drag(1, ...)`; GTK's `button-release-event` is delivered to the grab widget when `GDK_BUTTON_RELEASE_MASK` is enabled, and GTK `event-after` runs regardless of earlier event-handler return values.
- Added a GTK/GDK `BUTTON_RELEASE_MASK` plus `connect_event_after` observer to every magnetic widget window. Setup registers already-existing/static widget windows directly on the GTK main thread; dynamically built windows schedule registration through `run_on_main_thread`, wait only to a 2500 ms deadline, and destroy the hidden window on registration failure. No GTK object is accessed off the main thread or passed to the Niri blocking workers.
- The native callback accepts only primary-button release on the exact widget window, marks the sole prepared token for that widget released once, and emits `cluster-native-drag-release` only to that exact window with `{ windowLabel, dragToken }`.
- Rust now refuses and consumes `complete_widget_drag` tokens that lack authoritative release evidence. Wrong-widget, duplicate, replayed, canceled, expired, and pre-release completion paths fail closed.
- TypeScript installs the release listener before `startDragging`, requires the current window label to equal `widget-${widgetId}`, ignores malformed/wrong-label/wrong-token events, and waits for both exact release evidence and successful `startDragging()` completion before asking the main controller to snapshot. Release-before-promise and release-after-promise orderings are both safe.
- Timeout, edit-mode exit, widget-root unmount, and `startDragging` failure remove the listener, cancel the token, and retain the existing rollback event. Holding a moved window stationary while still pressed never satisfies completion; absence of release evidence only reaches the bounded cancel path.

### RED evidence

```text
pnpm exec vitest run apps/popup/src/__tests__/use-window-cluster.test.tsx
exit 1 — 4 intended failures because no cluster-native-drag-release listener existed and startDragging was not reached by the new contract

cargo test native_release -- --nocapture
exit 101 — missing observe_native_drag_release/take_released_drag and release_observed token state
```

### Deterministic coverage

- exact release before the pending `startDragging` promise resolves;
- resolved `startDragging` before exact release;
- 2400 ms stationary hold with no snapshot and bounded no-release timeout cancellation;
- wrong window label, wrong token, duplicate/replayed release;
- release followed by `startDragging` rejection;
- edit cancellation and widget-root unmount cleanup/rollback;
- Rust exact-label observation, one-use release marking, pre-release completion rejection/consumption, wrong-widget rejection, successful released-token consumption, and replay rejection;
- native Linux GTK/Tauri integration compiled through focused tests, full tests, clippy, and `cargo test --no-run`.

### Final verified gates

```text
focused TS suites
2 files / 31 tests passed

focused Rust release tests
2 focused tests passed; cargo test --no-run compiled Linux GTK integration

pnpm run typecheck
passed — contracts, core, daemon, popup, web

pnpm run test
passed — 48 files / 201 tests

pnpm run lint
passed

cargo test
passed — 23 Rust tests plus doc tests

cargo fmt --all -- --check
passed

cargo clippy --all-targets --all-features -- -D warnings
passed

cargo test --no-run
passed — Linux lib/main test executables built

pnpm run build
passed — popup 2058 modules transformed
(existing >500 kB Rollup chunk warning only)

git diff --check
passed
```

Tracked `tsconfig.tsbuildinfo` artifacts were restored after typecheck/build. The final candidate contains only the Task 6 report, GTK dependency/lock entry, Rust release observer/token enforcement, TypeScript release handshake, and deterministic hook tests. Added-line security scanning found no hardcoded-secret, shell-injection, eval/exec, or unsafe-deserialization match.

The configured OpenCode review model was unavailable and was not retried. Per coordinator direction, independent exact-diff review will run from an available runtime after this clean commit.

**NO LIVE GUI ACCEPTANCE WAS PERFORMED OR CLAIMED IN THIS FIX ROUND.** Exact-build Niri acceptance remains a separate post-commit gate.
