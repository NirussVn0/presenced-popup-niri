# Task 4 Report — Rust Niri window registry and lifecycle

## Status

**PASS** — Cluster Task 4 is implemented in the requested Rust-only scope.

## Files

- Created `apps/popup/src-tauri/src/window_cluster.rs`
  - Fixed widget/side/lane/size enums and payload validation.
  - One static registry for the main identity, seven hidden optional widget windows, and the hidden 820×680 settings window.
  - Exact PID/title Niri mapping with malformed, unknown, cross-PID, and duplicate handling.
  - Bounded Niri discovery/centering workers using fixed command/action arguments and one concise exhaustion diagnostic per exhausted operation.
  - Typed Tauri lifecycle commands for initialization, visibility, layout, edit mode, and widget hiding.
  - Pure projected geometry that never resizes or displaces the main window.
  - Rust unit tests for mapping, validation, registry completeness, and geometry.
- Modified `apps/popup/src-tauri/src/lib.rs`
  - Moved Niri parsing/centering into `window_cluster`.
  - Registered only the five Task 4 commands and delegated setup to the module.
- Created `.superpowers/sdd/2026-08-21-magnetic-window-cluster/task-4-report.md`.

No popup React UI, daemon, contracts, credentials, generated schemas, or tsbuildinfo files were modified.

## RED evidence

### Required PID/title mapping RED

Command from `apps/popup/src-tauri`:

```text
cargo test
```

Expected failure observed before implementation (exit 101):

```text
error[E0432]: unresolved import `super::find_niri_windows`
 --> src/window_cluster.rs:3:9
  |
3 |     use super::find_niri_windows;
  |         ^^^^^^^^^^^^^^^^^^^^^^^^ no `find_niri_windows` in `window_cluster`
error: could not compile `presenced-popup` (lib test) due to 1 previous error
```

### Typed payload/registry/geometry RED

Command:

```text
cargo test window_cluster::tests
```

Expected failure observed before those symbols were implemented (exit 101):

```text
error[E0432]: unresolved imports `super::project_layout`, `super::validate_layout`,
`super::ClusterLayoutV1Payload`, `super::Lane`, `super::Rect`, `super::Side`,
`super::SizePreset`, `super::WidgetId`, `super::WidgetPlacementPayload`,
`super::WINDOW_REGISTRY`
```

## GREEN and exact gates

All commands ran from `apps/popup/src-tauri`.

1. Focused GREEN:

```text
cargo test window_cluster::tests
exit 0 — 9 passed; 0 failed
```

2. Full Rust test gate:

```text
cargo test
exit 0 — lib: 9 passed; 0 failed; main: 0 passed; doc-tests: 0 passed
```

3. Formatting gate:

```text
cargo fmt --check
exit 0 — no output
```

4. Clippy gate:

```text
cargo clippy --all-targets -- -D warnings
exit 0 — Finished `dev` profile; no warnings
```

## Self-review

- Payload strings are never used for registry/window/Niri lookup before conversion through `WidgetId`, `Side`, `Lane`, or `SizePreset`; Niri titles are accepted only through the fixed registry-backed `WindowLabel` parser.
- Layout version and duplicate widget placement validation are enforced in Rust.
- Optional widget windows and settings are created hidden from one static registry table with fixed labels, titles, URLs, and dimensions.
- Main is made non-resizable during setup; layout projection returns optional windows only, and no layout action targets the main Niri ID.
- Niri subprocess command names and action names are fixed; only validated numeric IDs and projected numeric geometry are interpolated.
- Discovery and startup centering retries are count-bounded. Child stderr is captured, so retries do not emit noisy per-attempt diagnostics; only one concise exhaustion line is emitted by each exhausted worker operation.
- The startup worker captures only the PID. The layout worker captures only the PID and validated Rust layout. Neither captures nor invokes an `AppHandle` or `WebviewWindow`; native window show/hide/build operations occur outside the Niri worker closures.
- No unsafe code, credentials, tokens, raw window-title logging, shell invocation, or generated-file churn was added.
- Diff scope was checked with `git status`, `git diff --check`, and `git diff --name-only` before reporting.

## Concerns

- No live multi-window Tauri/Niri runtime smoke test was performed in this task; verification is the requested compile/unit/fmt/clippy gate set. The native worker-thread safety invariant is enforced structurally and reviewed in the diff.
- The pre-existing configured Tauri anchor label remains `main`; setup assigns its exact Niri title `presenced:widget-main`, so Niri discovery exposes the required `widget-main` key without modifying the out-of-scope Tauri config.
