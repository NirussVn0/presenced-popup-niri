# Task 4 Report — Rust Niri window registry and lifecycle

## Status

**SUPERSEDED BY FIX ROUND 1 BELOW** — this section records the original `084a345` implementation self-report; the appended fix-round evidence is current.

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

---

## Fix round 1 — Important review findings

### Status and scope

Starting point: `084a34565f2673d7511b222c379cfee90db2f39e` on `feat/complete-popup-cluster`.

All six independent Critical/Important findings were addressed together. The scoped fix modifies only:

- `apps/popup/src-tauri/src/window_cluster.rs`
- `apps/popup/src-tauri/src/lib.rs`
- `apps/popup/src-tauri/tauri.conf.json`
- this report

### RED evidence

All RED commands ran from `apps/popup/src-tauri` and failed for the intended missing behavior before its implementation.

1. Canonical fixed main identity / no maximize path:

```text
cargo test window_cluster::tests::configured_main_matches_registry_and_has_no_resize_path -- --exact
exit 101 — assertion failed: configured label was Null, expected "widget-main"
```

2. Close lifecycle policy:

```text
cargo test window_cluster::tests::close_requests_follow_cluster_lifecycle_policy -- --exact
exit 101 — unresolved imports close_disposition and CloseDisposition
```

3. Output bounds and collision overflow projection:

```text
cargo test window_cluster::tests::marks_output_overflow_and_collisions_for_hiding -- --exact
exit 101 — project_layout accepted no output argument and returned no overflow_widget_ids
```

4. Bounded and reaped subprocess execution:

```text
cargo test window_cluster::tests::timed_out_child_is_killed_and_reaped -- --exact
exit 101 — unresolved import wait_for_child_with_timeout
```

5. Stale apply rejection:

```text
cargo test window_cluster::tests::stale_apply_generation_cannot_commit -- --exact
exit 101 — unresolved import ApplyGenerationTracker
```

6. Failed apply degraded visibility:

```text
cargo test window_cluster::tests::failed_apply_commits_no_optional_visibility -- --exact
exit 101 — unresolved imports committed_visibility and AppliedNiriLayout
```

7. Overflow hiding is connected to the actual applied projection:

```text
cargo test window_cluster::tests::marks_output_overflow_and_collisions_for_hiding -- --exact
exit 101 — unresolved import visible_projected_widget_ids
```

Each focused test was then rerun GREEN before moving to the next seam.

### Corrected behavior

- `widget-main` is now the one configured/registry/setup identity. The configured main is exactly 720×420, non-resizable, non-maximizable, and bounded by matching min/max dimensions. The Rust maximize command and handler registration were removed.
- Main close requests are intercepted, every registered cluster window is force-destroyed with all close attempts made, and the app explicitly exits. Optional widget closes prevent destruction and hide. Settings close hides settings, shows main, and returns focus to main. The same policy backs the `close_window` command.
- Every layout/side apply receives a monotonic generation and is serialized by one async mutex. Older queued work is skipped; in-flight stale work is hidden and cannot commit. The generation/data mutex closes the final check-to-commit race.
- Stored layout, edit-mode emission, and final optional visibility are committed only after successful Niri projection/actions. Required windows are staged only for Niri mapping; every success, failure, join error, and stale result runs the all-optional hide pass before any final visibility commit. Failed applies retain the prior stored layout and leave optional windows hidden.
- Worker input is plain `pid + validated layout + Rect`. `AppHandle`, monitor lookup, window creation, visibility, events, and focus remain outside `spawn_blocking`.
- Every `niri` process uses one timeout runner. It polls to a deadline, kills on timeout/error, calls `wait` to reap, drains both pipes concurrently, and never uses shell invocation. Discovery retries and all actions use that runner.
- Rust projection now mirrors the TypeScript bounds/collision contract: clamp to output, detect desired out-of-bounds or clamped overlap (including main/prior projected windows), preserve explicit overflow IDs, and omit overflow widgets from Niri actions/final visibility.
- The dead controller Niri-ID cache was removed. Registry tests now assert every exact unique label/title, dimensions, hidden policy, and magnetic membership, including config consistency for main.

### GREEN and required gate evidence

Final commands ran from `apps/popup/src-tauri` after `cargo fmt`.

```text
cargo test window_cluster::tests
exit 0 — 15 passed; 0 failed

cargo test
exit 0 — lib: 15 passed; 0 failed; main: 0 passed; doc-tests: 0 passed

cargo fmt --check
exit 0 — no output

cargo clippy --all-targets -- -D warnings
exit 0 — Finished dev profile; no warnings
```

Additional scope checks:

```text
git diff --check
exit 0 — no whitespace errors
```

No React UI, daemon, contracts, credentials, raw-title logging, shell command construction, generated schemas, or tsbuildinfo artifacts were changed.

### Fix-round concerns

- No live Tauri/Niri multi-window smoke test was performed. Deterministic lifecycle decisions, projection, timeout/reaping, failure visibility, and stale-generation behavior are unit-tested; native integration is compile/fmt/clippy verified.
- Optional windows must be temporarily mapped for Niri to discover numeric IDs. They are always hidden immediately after the bounded worker and are shown as committed UI only after a successful latest-generation apply; every failure/stale path executes the hide-all degraded-state pass.
