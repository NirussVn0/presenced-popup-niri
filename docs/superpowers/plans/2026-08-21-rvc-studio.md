# RVC Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mismatched display-only RVC settings with a typed, persisted, live-applied Discord Rich Presence Studio and an exact outgoing-status widget.

**Architecture:** `packages/contracts` owns configuration/runtime schemas and migration. A single scheduler/controller validates, persists, applies, tests, rate-limits, and emits runtime state. Hono exposes typed settings/runtime/Test Now endpoints. React Studio edits canonical entries and renders exact payload/error state; `widget-rvc` consumes runtime truth.

**Tech Stack:** Zod, TypeScript, Node EventEmitter, Hono, SQLite KV, Discord local RPC, React 19, Vitest.

## Global Constraints

- No Discord user token, selfbot, or Custom Status mutation.
- One active Discord activity at a time.
- Asset values are Developer Portal keys or HTTPS URLs only.
- Entry duration 15–3600 seconds; global publish interval at least 15 seconds.
- At most two HTTPS buttons.
- No raw window title in default templates.
- Music changes are event-driven and coalesced; position ticks never publish.
- Save updates persistence and live scheduler atomically; no restart.
- Connected and last-payload-accepted are separate states.

---

## File Structure

**Create:**

- `packages/contracts/src/rvc.ts`
- `packages/contracts/src/__tests__/rvc.test.ts`
- `apps/daemon/src/outputs/discord/rvc-controller.ts`
- `apps/daemon/src/__tests__/rvc-controller.test.ts`
- `apps/daemon/src/__tests__/rvc-api.test.ts`
- `apps/popup/src/settings/RvcStudio.tsx`
- `apps/popup/src/settings/RvcEntryEditor.tsx`
- `apps/popup/src/components/DiscordActivityPreview.tsx`
- `apps/popup/src/hooks/useRvcStudio.ts`
- `apps/popup/src/__tests__/rvc-studio.test.tsx`
- `apps/popup/src/__tests__/rvc-widget-runtime.test.tsx`

**Modify:**

- `packages/contracts/src/index.ts`
- `packages/contracts/src/presence.ts`
- `apps/daemon/src/outputs/discord/discord-types.ts`
- `apps/daemon/src/outputs/discord/rvc-scheduler.ts`
- `apps/daemon/src/state/database.ts`
- `apps/daemon/src/state/presence-store.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/main.ts`
- `apps/popup/src/hooks/usePresenceCompanion.ts`
- `apps/popup/src/settings/SettingsPanel.tsx`
- `apps/popup/src/widgets/RvcWidget.tsx`
- `apps/popup/src/WindowRoot.tsx`

---

### Task 1: Canonical RVC v2 schemas and migration

**Files:**
- Create: `packages/contracts/src/rvc.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/presence.ts`
- Test: `packages/contracts/src/__tests__/rvc.test.ts`

**Interfaces:**
- Produces: `RvcConfigV2`, `RvcEntry`, `RvcActivityTemplate`, `RvcRuntimeState`, schemas, defaults, `migrateRvcConfig`.

- [ ] **Step 1: Write failing contract tests**

Test:

- Valid Custom/Music/Quote entries.
- Reject HTTP image/button URLs, more than two buttons, duration 14/3601, duplicate IDs, empty custom activity.
- Migrate frontend legacy `{ type, customText }`.
- Migrate daemon legacy `{ scene, customActivity }`.
- Preserve disabled unmigratable entries with a reason.

```ts
expect(migrateRvcConfig({
  enabled: true,
  tickIntervalSec: 30,
  entries: [{ id: "x", type: "custom", customText: "Building", durationSec: 60, enabled: true }],
})).toMatchObject({
  version: 2,
  entries: [{ id: "x", mode: "custom", template: { detailsTemplate: "Building" } }],
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run packages/contracts/src/__tests__/rvc.test.ts`.

- [ ] **Step 3: Implement exact schemas**

```ts
export const RvcModeSchema = z.enum(["auto", "music", "custom", "quote", "pomodoro"]);
export const DiscordActivityTypeSchema = z.enum(["playing", "listening", "watching"]);
export const TimestampModeSchema = z.enum(["none", "elapsed", "remaining", "media"]);
export const HttpsUrlSchema = z.string().min(1).max(512).url()
  .refine((value) => new URL(value).protocol === "https:");
export const AssetValueSchema = z.string().min(1).max(300).refine(
  (value) => !value.includes("://") || HttpsUrlSchema.safeParse(value).success,
  "Asset must be a key or HTTPS URL",
);

export const RvcButtonSchema = z.object({
  label: z.string().min(1).max(32),
  url: HttpsUrlSchema,
});

export const RvcActivityTemplateSchema = z.object({
  activityType: DiscordActivityTypeSchema,
  detailsTemplate: z.string().max(128).optional(),
  stateTemplate: z.string().max(128).optional(),
  largeImage: AssetValueSchema.optional(),
  largeText: z.string().min(2).max(128).optional(),
  smallImage: AssetValueSchema.optional(),
  smallText: z.string().min(2).max(128).optional(),
  timestampMode: TimestampModeSchema,
  buttons: z.array(RvcButtonSchema).max(2),
});
```

Define `RvcRuntimeStateSchema` with active entry, mode, timestamps, last payload, and structured last error.

- [ ] **Step 4: Add runtime state to `PresenceSnapshot`**

Add an optional/nullable typed RVC field with a default disconnected state so old persisted snapshots remain parseable.

- [ ] **Step 5: Run tests/typecheck and commit**

Commit: `feat(rvc): add canonical v2 contracts and migration`.

---

### Task 2: Typed persistence and migration

**Files:**
- Modify: `apps/daemon/src/state/database.ts`
- Modify: `apps/daemon/src/state/presence-store.ts`
- Test: `apps/daemon/src/__tests__/database.test.ts`
- Test: `apps/daemon/src/__tests__/presence-store.test.ts`

**Interfaces:**
- Produces: `getRvcConfig(): RvcConfigV2`, `saveRvcConfig(config: RvcConfigV2)`, `setRvcRuntime(state)`.

- [ ] **Step 1: Write failing persistence tests**

Cover default config, legacy migration, v2 round-trip, restart survival, malformed JSON fallback with degraded reason, and runtime snapshot update.

- [ ] **Step 2: Replace `any[]` store signatures**

Remove every RVC `any` type in database/store/API-facing code. Parse reads with `migrateRvcConfig`; writes accept only `RvcConfigV2`.

- [ ] **Step 3: Persist migration exactly once**

When legacy config migrates successfully, save v2 in the same read transaction boundary. Preserve a backup KV key `rvc-config-legacy-backup` until the integrated release passes.

- [ ] **Step 4: Run focused/full tests and commit**

Commit: `feat(rvc): persist validated v2 configuration`.

---

### Task 3: Deterministic scheduler and runtime truth

**Files:**
- Create: `apps/daemon/src/outputs/discord/rvc-controller.ts`
- Modify: `apps/daemon/src/outputs/discord/rvc-scheduler.ts`
- Modify: `apps/daemon/src/outputs/discord/discord-types.ts`
- Test: `apps/daemon/src/__tests__/rvc-controller.test.ts`

**Interfaces:**

```ts
export interface RvcController {
  getConfig(): RvcConfigV2;
  applyConfig(config: RvcConfigV2): Promise<RvcRuntimeState>;
  getRuntimeState(): RvcRuntimeState;
  updatePresence(presence: ResolvedPresence | null): void;
  testEntry(entry: RvcEntry): Promise<RvcTestResult>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write failing fake-clock/fake-client tests**

Test sequential rotation, disabled entries, per-entry duration, 15-second rate floor, config update without restart, track-identity preemption/coalescing, quote cache, accepted payload runtime state, rejected payload state, and stop cleanup.

- [ ] **Step 2: Extend Discord payload type**

Add activity `type` mapping and up to two `{ label, url }` buttons. Keep Zod validation before `setActivity`.

```ts
const ACTIVITY_TYPE = { playing: 0, listening: 2, watching: 3 } as const;
```

- [ ] **Step 3: Implement pure template rendering**

Create a pure renderer accepting explicit context. Reject unknown variables; do not read environment/global state. Missing values suppress a field or use configured fallback.
Validate the fully rendered `details`, `state`, and hover text again before publishing because variable expansion can exceed the template source length.

- [ ] **Step 4: Refactor scheduler behind controller**

Eliminate the current dual `DiscordScheduler` plus RVC scheduler race: when RVC is enabled, RVC controller is the sole publisher; when disabled, normal DiscordScheduler publishes resolved presence. Transition atomically and clear obsolete timers.
Resolve `quoteFile` only beneath the bundled quotes directory or `$XDG_DATA_HOME/presenced/quotes`; reject traversal, symlink escape, and every other root before reading.

- [ ] **Step 5: Emit runtime state to PresenceStore**

Every accepted/rejected publish updates `RvcRuntimeState` once. Do not emit on media position ticks.

- [ ] **Step 6: Run tests/typecheck and commit**

Commit: `feat(rvc): add live controller and truthful runtime state`.

---

### Task 4: Typed API, live apply, and Test Now

**Files:**
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/main.ts`
- Test: `apps/daemon/src/__tests__/rvc-api.test.ts`

**Interfaces:**
- `ApiServerOptions.rvcController?: RvcController`.
- `GET /api/settings/rvc`.
- `PUT /api/settings/rvc`.
- `POST /api/settings/rvc/test`.
- `GET /api/rvc/runtime`.

- [ ] **Step 1: Write failing route tests**

Assert valid GET/PUT, invalid payload 400 with `invalid_rvc_config`, immediate controller apply, controller failure leaves old persisted/live config intact, Test Now accepted/rejected response, and runtime GET.

- [ ] **Step 2: Inject controller into API server**

Do not import a singleton. Pass the interface from `main.ts` for testability.

- [ ] **Step 3: Implement atomic PUT**

Validate first, ask controller to apply, persist only on success, broadcast config/runtime. If apply fails, keep prior scheduler and DB config and return a stable error.

- [ ] **Step 4: Implement Test Now**

Parse one `RvcEntry`, render against current presence, publish as a temporary test, return exact payload and acceptance/rejection, then resume prior rotation without changing index/order.

- [ ] **Step 5: Run focused/full tests and commit**

Commit: `feat(rvc): expose live configuration and test API`.

---

### Task 5: Typed popup API bridge

**Files:**
- Create: `apps/popup/src/hooks/useRvcStudio.ts`
- Modify: `apps/popup/src/hooks/usePresenceCompanion.ts`
- Test: `apps/popup/src/__tests__/rvc-studio-hook.test.ts`

**Interfaces:**
- Produces `load`, `save`, `testEntry`, `runtime`, `saving`, `testing`, `error`.

- [ ] **Step 1: Write failing fetch-state tests**

Mock success, validation 400, unavailable daemon, rejected Test Now, and WebSocket runtime update.

- [ ] **Step 2: Remove legacy RVC methods from companion hook**

Replace `any[]` API methods with the dedicated typed hook. Do not maintain two sources of truth.

- [ ] **Step 3: Implement abortable requests and runtime subscription**

Abort stale loads/tests on unmount or replacement. Show stable reason codes; never collapse rejection into a generic Connected state.

- [ ] **Step 4: Run tests/typecheck and commit**

Commit: `feat(rvc): add typed Studio client bridge`.

---

### Task 6: RVC Studio editor and payload preview

**Files:**
- Create: `apps/popup/src/settings/RvcStudio.tsx`
- Create: `apps/popup/src/settings/RvcEntryEditor.tsx`
- Create: `apps/popup/src/components/DiscordActivityPreview.tsx`
- Modify: `apps/popup/src/settings/SettingsPanel.tsx`
- Delete after migration: `apps/popup/src/settings/RvcSettings.tsx`
- Test: `apps/popup/src/__tests__/rvc-studio.test.tsx`

**Interfaces:**
- Consumes `useRvcStudio` and canonical contracts.
- Produces ordered editor with exact preview, Test Now, Save & Apply.

- [ ] **Step 1: Write failing component tests**

Cover add each mode, edit details/state, insert variables, invalid URL/length, assets, timestamps, two-button limit, duplicate/delete/enable, reorder, Test Now accepted/rejected, Save success/failure, dirty-state navigation guard.

- [ ] **Step 2: Implement entry list and editor**

Use semantic controls and keyboard reorder buttons in addition to drag. Each entry owns its complete template; no hidden global image fields.

- [ ] **Step 3: Implement exact preview**

`DiscordActivityPreview` receives the same rendered payload returned by validation/Test Now. It must not independently guess template output.

- [ ] **Step 4: Implement assets**

Show Asset Key vs HTTPS URL classification, bounded image preview, hover text, loading/error state. Never attempt Developer Portal upload or local-file conversion.

- [ ] **Step 5: Implement Test Now and Save & Apply feedback**

Display accepted payload, rejection code/message, last accepted timestamp, and unsaved state. Disable actions while invalid.

- [ ] **Step 6: Run tests/build/visual review and commit**

Commit: `feat(rvc): ship Rich Presence Studio` after independent UI review.

---

### Task 7: Truthful independent RVC widget

**Files:**
- Modify: `apps/popup/src/widgets/RvcWidget.tsx`
- Modify: `apps/popup/src/WindowRoot.tsx`
- Test: `apps/popup/src/__tests__/rvc-widget-runtime.test.tsx`

**Interfaces:**
- Consumes `RvcRuntimeState` only.
- Produces compact main module and expanded `widget-rvc` window variant.

- [ ] **Step 1: Write failing truth-state tests**

Test disconnected, connected/no accepted payload, accepted Custom/Music/Quote payload, next-rotation countdown, and last rejection while retaining last accepted payload.

- [ ] **Step 2: Implement compact and expanded variants**

Compact shows connection, active mode, exact details/state. Expanded adds assets, next rotation, last publish, and error. Never use `snapshot.presence.title` as a substitute for outgoing RVC state.

- [ ] **Step 3: Run tests and commit**

Commit: `feat(rvc): show exact outgoing status in widget`.

---

### Task 8: RVC acceptance gate

- [ ] Start with migrated empty/default config; verify no fake published payload.
- [ ] Create Custom entry with details/state, activity type, two assets, hover text, timestamp, and button; Test Now and inspect Discord.
- [ ] Create Music, Quote, and Pomodoro entries; verify sequential rotation and exact timing within rate limits.
- [ ] Change track; verify one coalesced identity update and no position-tick spam.
- [ ] Save config; restart daemon; verify order/runtime state survives.
- [ ] Use invalid HTTPS/asset/length/button values; verify Save/Test blocked.
- [ ] Disconnect/reconnect Discord; verify runtime errors and recovery truthfully.
- [ ] Verify no raw titles, filesystem paths, tokens, or unbounded quote reads.
- [ ] Run full TS/Rust/Tauri gates and independent security/truthfulness/UI review.
