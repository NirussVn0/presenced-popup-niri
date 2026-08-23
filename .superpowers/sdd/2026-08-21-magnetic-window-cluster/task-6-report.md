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
