# Magnetic Window Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-window side drawers with independently managed Tauri widget windows that magnetically attach to a centered main dashboard without overlap or geometry drift.

**Architecture:** A typed logical layout is persisted by the daemon. Pure TypeScript derives deterministic slot geometry relative to the main window. Rust owns Tauri window lifecycle and bounded Niri IPC; React renders one widget root per window label and exposes Edit-mode actions.

**Tech Stack:** Zod contracts, TypeScript, Vitest, React 19, Tauri v2/Rust, Niri JSON IPC, Hono, SQLite KV.

## Global Constraints

- Main window label `widget-main`, exactly 720×420, centered.
- Optional labels: `widget-music`, `widget-rvc`, `widget-lyrics`, `widget-system`, `widget-countdown`, `widget-pomodoro`, `widget-quote`.
- Persist logical slots only; no absolute monitor coordinates.
- No optional window is created visible by default.
- Normal mode locks native movement and resize.
- Main close exits all windows; optional close hides only that window.
- Niri commands receive fixed strings or numeric IDs only.

---

## File Structure

**Create:**

- `packages/contracts/src/widget-layout.ts` — versioned schemas and defaults.
- `apps/popup/src/lib/window-cluster-layout.ts` — pure slot projection/insertion.
- `apps/popup/src/hooks/useWindowCluster.ts` — UI bridge to API and Tauri commands.
- `apps/popup/src/WindowRoot.tsx` — render dispatch by Tauri window label.
- `apps/popup/src/widgets/WidgetWindowShell.tsx` — common independent-window shell.
- `apps/popup/src-tauri/src/window_cluster.rs` — Niri discovery, Tauri lifecycle, placement.
- `apps/daemon/src/__tests__/widget-layout-api.test.ts`.
- `apps/popup/src/__tests__/window-cluster-layout.test.ts`.

**Modify:**

- `packages/contracts/src/index.ts`.
- `apps/daemon/src/state/database.ts`.
- `apps/daemon/src/state/presence-store.ts`.
- `apps/daemon/src/api/server.ts`.
- `apps/popup/src-tauri/src/lib.rs`.
- `apps/popup/src/main.tsx`.
- `apps/popup/src/App.tsx`.
- `apps/popup/src/settings/SettingsPanel.tsx`.
- `apps/popup/src/lib/widget-registry.ts`.

---

### Task 1: Versioned widget-layout contract

**Files:**
- Create: `packages/contracts/src/widget-layout.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/__tests__/widget-layout.test.ts`

**Interfaces:**
- Produces: `WidgetWindowId`, `WidgetSide`, `WidgetLane`, `WidgetSizePreset`, `WidgetPlacement`, `ClusterLayoutV1`, `ClusterLayoutV1Schema`, `DEFAULT_CLUSTER_LAYOUT`.
- Consumed by: daemon persistence/API, projection model, Settings, Rust command payloads.

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { ClusterLayoutV1Schema, DEFAULT_CLUSTER_LAYOUT } from "../widget-layout.js";

describe("ClusterLayoutV1", () => {
  it("defaults to a main-only layout", () => {
    expect(DEFAULT_CLUSTER_LAYOUT).toEqual({
      version: 1,
      leftVisible: false,
      rightVisible: false,
      editMode: false,
      placements: [],
    });
  });

  it("rejects duplicate widget placements", () => {
    const duplicate = {
      ...DEFAULT_CLUSTER_LAYOUT,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
        { widgetId: "music", side: "right", order: 0, lane: "top", size: "standard", visible: true },
      ],
    };
    expect(ClusterLayoutV1Schema.safeParse(duplicate).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/contracts/src/__tests__/widget-layout.test.ts`

Expected: FAIL because `widget-layout.ts` does not exist.

- [ ] **Step 3: Implement exact schemas and default**

```ts
import { z } from "zod";

export const WidgetWindowIdSchema = z.enum([
  "music", "rvc", "lyrics", "system", "countdown", "pomodoro", "quote",
]);
export const WidgetSideSchema = z.enum(["left", "right"]);
export const WidgetLaneSchema = z.enum(["top", "middle", "bottom"]);
export const WidgetSizePresetSchema = z.enum(["compact", "standard", "tall", "wide"]);

export const WidgetPlacementSchema = z.object({
  widgetId: WidgetWindowIdSchema,
  side: WidgetSideSchema,
  order: z.number().int().min(0),
  lane: WidgetLaneSchema,
  size: WidgetSizePresetSchema,
  visible: z.boolean(),
});

export const ClusterLayoutV1Schema = z.object({
  version: z.literal(1),
  leftVisible: z.boolean(),
  rightVisible: z.boolean(),
  editMode: z.boolean(),
  placements: z.array(WidgetPlacementSchema),
}).superRefine((layout, ctx) => {
  const ids = new Set<string>();
  for (const placement of layout.placements) {
    if (ids.has(placement.widgetId)) {
      ctx.addIssue({ code: "custom", message: `Duplicate widget ${placement.widgetId}` });
    }
    ids.add(placement.widgetId);
  }
});

export type WidgetWindowId = z.infer<typeof WidgetWindowIdSchema>;
export type WidgetPlacement = z.infer<typeof WidgetPlacementSchema>;
export type ClusterLayoutV1 = z.infer<typeof ClusterLayoutV1Schema>;

export const DEFAULT_CLUSTER_LAYOUT: ClusterLayoutV1 = {
  version: 1,
  leftVisible: false,
  rightVisible: false,
  editMode: false,
  placements: [],
};
```

- [ ] **Step 4: Export and run contract tests**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./widget-layout.js";
```

Run: `pnpm exec vitest run packages/contracts/src/__tests__/widget-layout.test.ts`

Expected: PASS.

- [ ] **Step 5: Run contract typecheck and commit**

Run: `pnpm --filter @presenced/contracts run typecheck`

Commit:

```bash
git add packages/contracts/src/widget-layout.ts packages/contracts/src/index.ts packages/contracts/src/__tests__/widget-layout.test.ts
git commit -m "feat(cluster): add versioned widget layout contract"
```

---

### Task 2: Pure magnetic slot projection

**Files:**
- Create: `apps/popup/src/lib/window-cluster-layout.ts`
- Test: `apps/popup/src/__tests__/window-cluster-layout.test.ts`

**Interfaces:**
- Consumes: `ClusterLayoutV1`, `WidgetPlacement`.
- Produces: `Rect`, `ProjectedWidget`, `projectClusterLayout`, `insertPlacement`, `findNearestSlot`.

- [ ] **Step 1: Write failing projection tests**

```ts
import { describe, expect, it } from "vitest";
import { findNearestSlot, insertPlacement, projectClusterLayout } from "../lib/window-cluster-layout.js";

const main = { x: 600, y: 330, width: 720, height: 420 };
const output = { x: 0, y: 0, width: 1920, height: 1080 };

it("projects left and right windows without touching main", () => {
  const projected = projectClusterLayout({
    version: 1,
    leftVisible: true,
    rightVisible: true,
    editMode: false,
    placements: [
      { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
      { widgetId: "rvc", side: "right", order: 0, lane: "top", size: "standard", visible: true },
    ],
  }, main, output);
  expect(projected.main).toEqual(main);
  expect(projected.widgets.music.x + projected.widgets.music.width).toBe(main.x - 10);
  expect(projected.widgets.rvc.x).toBe(main.x + main.width + 10);
});

it("pushes occupied slots outward", () => {
  const next = insertPlacement(["music", "system"], "rvc", 0);
  expect(next).toEqual(["rvc", "music", "system"]);
});

it("snaps only within 24 pixels", () => {
  expect(findNearestSlot({ x: 350, y: 330 }, [{ id: "L1", x: 360, y: 330 }], 24)?.id).toBe("L1");
  expect(findNearestSlot({ x: 300, y: 330 }, [{ id: "L1", x: 360, y: 330 }], 24)).toBeNull();
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run apps/popup/src/__tests__/window-cluster-layout.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement projection constants and size table**

```ts
export const CLUSTER_GAP = 10;
export const SNAP_THRESHOLD = 24;
export const SIZE_PRESETS = {
  compact: { width: 220, height: 140 },
  standard: { width: 250, height: 190 },
  tall: { width: 250, height: 240 },
  wide: { width: 320, height: 180 },
} as const;
```

Implement projection relative to `main`, clamp every optional rect to `output`, and return an explicit `overflowWidgetIds` array rather than silently overlapping.

- [ ] **Step 4: Implement insertion and nearest-slot helpers**

```ts
export function insertPlacement(order: string[], widgetId: string, index: number): string[] {
  return [...order.filter((id) => id !== widgetId).slice(0, index), widgetId,
    ...order.filter((id) => id !== widgetId).slice(index)];
}
```

`findNearestSlot` uses Euclidean distance and returns `null` outside `SNAP_THRESHOLD`.

- [ ] **Step 5: Run tests/typecheck and commit**

Run:

```bash
pnpm exec vitest run apps/popup/src/__tests__/window-cluster-layout.test.ts
pnpm --filter @presenced/popup run typecheck
```

Commit:

```bash
git add apps/popup/src/lib/window-cluster-layout.ts apps/popup/src/__tests__/window-cluster-layout.test.ts
git commit -m "feat(cluster): add magnetic slot projection"
```

---

### Task 3: Persist layout through typed daemon API

**Files:**
- Modify: `apps/daemon/src/state/database.ts`
- Modify: `apps/daemon/src/state/presence-store.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/src/__tests__/widget-layout-api.test.ts`

**Interfaces:**
- Consumes: `ClusterLayoutV1Schema`, `DEFAULT_CLUSTER_LAYOUT`.
- Produces: `PresenceStore.getWidgetLayout()`, `PresenceStore.setWidgetLayout(layout)`, `GET/PUT /api/settings/widgets`.

- [ ] **Step 1: Write failing API round-trip tests**

Create an isolated database/server fixture. Assert GET returns `DEFAULT_CLUSTER_LAYOUT`, valid PUT persists and returns parsed layout, duplicate widget PUT returns 400, and a new store instance reads the saved layout.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`

Expected: FAIL with 404 or missing store methods.

- [ ] **Step 3: Add typed database/store methods**

```ts
public getWidgetLayout(): ClusterLayoutV1 {
  return this.database?.getKvParsed("widget-layout-v1", ClusterLayoutV1Schema)
    ?? DEFAULT_CLUSTER_LAYOUT;
}

public setWidgetLayout(layout: ClusterLayoutV1): void {
  this.database?.setKv("widget-layout-v1", layout);
}
```

Reuse or add focused KV helpers in `DatabaseManager`; do not duplicate raw SQL in the API.

- [ ] **Step 4: Add GET/PUT routes**

```ts
this.app.get("/api/settings/widgets", (c) => c.json(this.store.getWidgetLayout()));
this.app.put("/api/settings/widgets", async (c) => {
  const parsed = ClusterLayoutV1Schema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ code: "invalid_widget_layout", issues: parsed.error.issues }, 400);
  this.store.setWidgetLayout(parsed.data);
  return c.json(parsed.data);
});
```

- [ ] **Step 5: Run focused/full tests and commit**

Run:

```bash
pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts
pnpm run typecheck
pnpm run test
```

Commit the database, store, route, and tests as one vertical slice.

---

### Task 4: Rust Niri window registry and lifecycle

**Files:**
- Create: `apps/popup/src-tauri/src/window_cluster.rs`
- Modify: `apps/popup/src-tauri/src/lib.rs`
- Test: Rust unit tests in `window_cluster.rs`

**Interfaces:**
- Produces Tauri commands:
  - `initialize_widget_windows(layout: ClusterLayoutV1Payload)`
  - `set_cluster_visibility(side: String, visible: bool)`
  - `apply_widget_layout(layout: ClusterLayoutV1Payload)`
  - `set_cluster_edit_mode(enabled: bool)`
  - `hide_widget_window(widget_id: String)`
- Internal: `find_niri_windows(payload, pid) -> HashMap<String, u64>` keyed by exact title.

Rust mirrors the validated TypeScript payload explicitly:

```rust
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClusterLayoutV1Payload {
    version: u8,
    left_visible: bool,
    right_visible: bool,
    edit_mode: bool,
    placements: Vec<WidgetPlacementPayload>,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetPlacementPayload {
    widget_id: String,
    side: String,
    order: u32,
    lane: String,
    size: String,
    visible: bool,
}

struct WindowClusterController {
    app: tauri::AppHandle,
    pid: u32,
    niri_ids: std::collections::HashMap<String, u64>,
}
```

Every string is converted through a fixed enum parser before use.

- [ ] **Step 1: Write failing Rust tests for PID/title mapping**

```rust
#[test]
fn maps_same_pid_windows_by_exact_title() {
    let json = br#"[
      {"id": 11, "pid": 55, "title": "presenced:widget-main"},
      {"id": 12, "pid": 55, "title": "presenced:widget-rvc"}
    ]"#;
    let map = find_niri_windows(json, 55).unwrap();
    assert_eq!(map["widget-main"], 11);
    assert_eq!(map["widget-rvc"], 12);
}
```

Also test other PID exclusion, malformed JSON, unknown titles, and duplicate title rejection.

- [ ] **Step 2: Run `cargo test` and verify RED**

Expected: missing module/functions.

- [ ] **Step 3: Implement registry with bounded subprocesses**

Move existing Niri parsing/centering out of `lib.rs`. Use fixed command arguments, count-bounded retries, and one concise exhaustion diagnostic. Never capture a `WebviewWindow` in the Niri worker thread.

- [ ] **Step 4: Create hidden optional windows**

```rust
WebviewWindowBuilder::new(
    app,
    "widget-rvc",
    WebviewUrl::App("index.html?window=widget-rvc".into()),
)
.title("presenced:widget-rvc")
.inner_size(250.0, 190.0)
.transparent(true)
.decorations(false)
.skip_taskbar(true)
.visible(false)
.build()?;
```

Repeat from a static registry table rather than hand-written builders.
Create the `settings` window from the same table at 820×680, initially hidden; it is not assigned to a magnetic slot.

- [ ] **Step 5: Implement typed lifecycle commands**

Validate side/widget strings against fixed enums before any lookup. `set_cluster_visibility` shows/hides existing windows and then reapplies projected geometry. Main is never resized.

- [ ] **Step 6: Run Rust gates and commit**

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Commit Rust module plus `lib.rs` wiring.

---

### Task 5: Per-window React roots and cluster bridge

**Files:**
- Create: `apps/popup/src/WindowRoot.tsx`
- Create: `apps/popup/src/widgets/WidgetWindowShell.tsx`
- Create: `apps/popup/src/hooks/useWindowCluster.ts`
- Modify: `apps/popup/src/main.tsx`
- Modify: `apps/popup/src/App.tsx`
- Test: `apps/popup/src/__tests__/window-root.test.tsx`

**Interfaces:**
- Consumes Tauri labels/commands from Task 4 and layout API from Task 3.
- Produces `useWindowCluster()` with `toggleSide`, `openSettings`, `enterEdit`, `commitEdit`, `cancelEdit`, `hideWidget`.

- [ ] **Step 1: Write failing render dispatch tests**

Mock `getCurrentWindow().label`. Assert `widget-main` renders the dashboard, `widget-rvc` renders only RVC content in `WidgetWindowShell`, and unknown labels render a bounded unsupported state.

- [ ] **Step 2: Implement `WindowRoot` dispatch**

```tsx
const WINDOW_COMPONENTS = {
  "widget-main": MainDashboard,
  "widget-music": MusicWidgetWindow,
  "widget-rvc": RvcWidgetWindow,
  // remaining labels
} satisfies Record<string, React.ComponentType>;
```

Do not mount the complete dashboard tree in optional windows.

- [ ] **Step 3: Implement cluster hook**

Load layout once, invoke Rust initialization, subscribe to WebSocket layout changes, and expose error/degraded state. `<`/`>` call `set_cluster_visibility`; they do not set in-DOM panel state.

- [ ] **Step 4: Remove old `SidePanel` composition from App**

Delete in-window left/right drawers and their local state. Keep compact Music/RVC/primary modules in main. Expanded widgets live only in optional windows.

- [ ] **Step 5: Run focused/full tests and commit**

```bash
pnpm exec vitest run apps/popup/src/__tests__/window-root.test.tsx
pnpm run typecheck
pnpm run test
```

Commit the React bridge slice.

---

### Task 6: Edit mode, magnetic insertion, and Layout Settings

**Files:**
- Modify: `apps/popup/src/hooks/useWindowCluster.ts`
- Create: `apps/popup/src/settings/LayoutSettings.tsx`
- Modify: `apps/popup/src/settings/SettingsPanel.tsx`
- Modify: `apps/popup/src/components/TutorialOverlay.tsx`
- Modify: `apps/popup/src/widgets/WidgetWindowShell.tsx`
- Modify: `apps/popup/src-tauri/src/window_cluster.rs`
- Test: `apps/popup/src/__tests__/layout-settings.test.tsx`

**Interfaces:**
- Consumes projection helpers and lifecycle commands.
- Produces committed/candidate layout state and native drag completion flow.

- [ ] **Step 1: Write failing edit-state tests**

Assert normal mode hides drag/resize controls, Edit shows them, occupied drop inserts/pushes, Cancel restores original, Done performs one PUT and one geometry apply.

- [ ] **Step 2: Implement candidate layout transaction**

```ts
interface EditSession {
  committed: ClusterLayoutV1;
  candidate: ClusterLayoutV1;
  dirty: boolean;
}
```

No persistence occurs before Done.

- [ ] **Step 3: Implement native drag end and snap**

Rust reads one Niri snapshot after drag completion and returns the dragged window rect plus main rect. TypeScript selects the nearest slot and updates candidate order. Invalid/out-of-bounds drops animate back to the committed slot.

- [ ] **Step 4: Implement size presets and Layout Settings**

Provide side, order, lane, size, visible, reset, and overflow count. No free numeric width/height inputs.

- [ ] **Step 5: Add first-run widget selection**

Tutorial defaults to main-only and offers explicit checkboxes for optional expanded windows. Finishing the tutorial writes one valid `ClusterLayoutV1`; skipping keeps every optional window hidden.

- [ ] **Step 6: Verify runtime and commit**

Run unit/component gates, then launch on Niri and verify drag lock, snap, push, Cancel, Done, output switch, and no overlap. Obtain independent exact-commit review before marking Phase A complete.

---

### Task 7: Cluster acceptance gate

- [ ] Build Tauri release and install isolated/live artifacts.
- [ ] Record Niri JSON for main plus every enabled optional window.
- [ ] Assert main remains 720×420 and centered through `<`, `>`, Settings, Edit Done/Cancel.
- [ ] Assert all optional windows have unique titles, floating state, valid slots, no overlap, and no taskbar entries.
- [ ] Gracefully close each optional window, Settings, then main; require exit code 0 and no allocator/WebKit errors.
- [ ] Capture main-only, left-cluster, both-cluster, and Edit-mode screenshots.
- [ ] Run full TS/Rust/build gates and independent review.
- [ ] Commit only after PASS: `feat(cluster): ship magnetic multi-window widgets`.
