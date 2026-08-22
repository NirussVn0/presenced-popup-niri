# Magnetic Acrylic Cluster & RVC Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver presenced-popup-niri v0.7 as a centered main dashboard with magnetically attached independent widget windows, an Acrylic Sage cross-window theme, and a fully functional typed Discord RVC Studio.

**Architecture:** Work is split into three independently reviewable subsystem plans and one integrated release gate. The window cluster establishes Tauri/Niri window identity and persistence first; Acrylic then skins and synchronizes all windows; RVC contracts/backend precede the Studio UI. No subsystem may claim completion before its exact commit passes focused and full gates.

**Tech Stack:** TypeScript 5 strict mode, React 19, Tauri v2/Rust, Niri JSON IPC, Hono, Zod, SQLite KV persistence, Vitest, Framer Motion, Tailwind CSS.

## Global Constraints

- Main dashboard label `widget-main`, size 720×420, centered on the focused Niri output.
- Every optional widget is a distinct frameless, transparent, skip-taskbar Tauri window.
- Optional windows never resize, cover, or move the committed main-dashboard layout.
- `<` and `>` toggle complete left/right clusters with `hide`/`show`, not destroy/recreate.
- Drag and preset resize are available only in Edit mode; Done persists, Cancel restores.
- Layout persistence uses logical slots, never absolute screen pixels.
- Acrylic Sage is default; outer luminous acrylic and dark inner modules remain visually distinct.
- Discord integration uses local RPC only: no user token, selfbot, or Custom Status mutation.
- RVC config is Zod-validated, rate-controlled, and applied live without daemon restart.
- Discord image values accept only an uploaded asset key or HTTPS URL; local paths are rejected.
- Never publish raw window titles by default.
- Do not add dependencies merely to avoid straightforward TypeScript or Rust.
- Full gates: `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, `pnpm run build`, Rust test/fmt/clippy, Tauri release build, Niri runtime verification, independent review.

---

## Dependency Order

### Phase A — Magnetic multi-window cluster

Plan: `docs/superpowers/plans/2026-08-21-magnetic-window-cluster.md`

Produces:

```ts
ClusterLayoutV1
WidgetPlacement
projectClusterLayout(layout, mainRect, outputRect)
WindowClusterController
useWindowCluster()
```

Acceptance boundary: main remains 720×420 and centered while each optional Tauri window is independently shown, hidden, dragged in Edit mode, snapped, inserted, pushed, and persisted.

### Phase B — Acrylic cross-window theme

Plan: `docs/superpowers/plans/2026-08-21-acrylic-theme-system.md`

Consumes Phase A window labels and broadcast mechanism. Produces versioned theme contracts, Acrylic Sage presets, persisted settings, cross-window updates, and no-scroll widget shells.

Acceptance boundary: every open window updates theme immediately and matches the outer-acrylic/inner-module hierarchy at required screenshots and reduced motion.

### Phase C — Typed RVC backend and Studio

Plan: `docs/superpowers/plans/2026-08-21-rvc-studio.md`

Can develop contracts/backend after Phase A contracts land, but its independent `widget-rvc` window integrates only after Phase A. Produces `RvcConfigV2`, migration, live scheduler updates, runtime state, Test Now, typed APIs, Studio UI, and exact outgoing-payload widget.

Acceptance boundary: editing custom text/templates/assets/rotation changes the actual accepted Discord RPC payload without daemon restart, and rejection remains visible.

### Phase D — Integrated release

- [ ] Rebase the three accepted subsystem commits onto current `main` in dependency order: Cluster → Acrylic → RVC.
- [ ] Run `pnpm install --frozen-lockfile` twice and verify the second run is byte-idempotent for the lockfile.
- [ ] Run `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, and `pnpm run build`.
- [ ] Run `cargo test`, `cargo fmt --check`, and `cargo clippy --all-targets -- -D warnings` in `apps/popup/src-tauri`.
- [ ] Run `pnpm --filter @presenced/popup tauri build` and verify binary, `.deb`, and `.rpm` artifacts.
- [ ] Install to an isolated `$HOME` fixture; verify layout/theme/RVC migrations and installer idempotence.
- [ ] Install on live Niri, launch `widget-main`, and record Niri JSON for all enabled widget window labels.
- [ ] Verify main geometry remains centered and unchanged through left/right toggles, Settings open/close, Edit Done, and Edit Cancel.
- [ ] Verify every optional widget is floating, in a valid slot, non-overlapping, and absent from the taskbar.
- [ ] Verify Discord disconnected, connected, payload accepted, payload rejected, and reconnect flows.
- [ ] Capture Acrylic Sage visual evidence: main only, left cluster, both clusters, Settings, RVC Studio, reduced motion.
- [ ] Scan outgoing payloads for raw titles, paths, tokens, and noisy per-position updates.
- [ ] Dispatch independent exact-commit review; block release on any logic, security, truthfulness, runtime, accessibility, or visual hierarchy issue.
- [ ] Commit remediation separately, rerun all gates, and obtain final PASS.
- [ ] Update `README.md`, `docs/INSTALLATION.md`, `docs/UI_UX.md`, and release notes with only verified behavior.

## Execution Checkpoints

1. Cluster commit and independent review PASS.
2. Acrylic commit and independent review PASS.
3. RVC backend commit and independent review PASS.
4. RVC Studio/widget commit and independent review PASS.
5. Integrated release commit and exact-SHA acceptance PASS.

No checkpoint may be replaced by a plan, static mockup, unit tests alone, or an unverified build artifact.
