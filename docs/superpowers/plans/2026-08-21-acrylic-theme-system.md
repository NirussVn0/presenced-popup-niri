# Acrylic Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Acrylic Sage reference hierarchy consistently across every Tauri widget window with versioned persistence, presets, manual controls, and immediate cross-window updates.

**Architecture:** A typed theme contract persists through the daemon settings store. Each WebView applies CSS variables through one hook and receives updates over WebSocket/BroadcastChannel. Outer window acrylic and dark inner modules remain separate token layers; optional widget shells never scroll.

**Tech Stack:** Zod, TypeScript, Hono, SQLite KV, React 19, Tailwind CSS, CSS variables, Vitest.

## Global Constraints

- Acrylic Sage is the default.
- Outer glass: sage tint, 48% opacity, 30 px blur, 1.15 saturation, 24 px radius.
- Inner modules: near-black 78% opacity, 16 px blur, 18 px radius.
- Presets plus manual tint/opacity/blur/saturation/darkness/border/glow.
- Every open window updates without reload.
- Widget windows do not scroll; Settings may scroll.
- `prefers-reduced-motion` remains authoritative.

---

## File Structure

**Create:**

- `packages/contracts/src/theme.ts`
- `packages/contracts/src/__tests__/theme.test.ts`
- `apps/popup/src/lib/theme-presets.ts`
- `apps/popup/src/components/AcrylicWindowShell.tsx`
- `apps/daemon/src/__tests__/theme-settings-api.test.ts`
- `apps/popup/src/__tests__/acrylic-theme.test.tsx`

**Modify:**

- `packages/contracts/src/index.ts`
- `apps/daemon/src/state/database.ts`
- `apps/daemon/src/state/presence-store.ts`
- `apps/daemon/src/api/server.ts`
- `apps/popup/src/hooks/useTheme.ts`
- `apps/popup/src/settings/ThemeSettings.tsx`
- `apps/popup/src/widgets/WidgetWindowShell.tsx`
- `apps/popup/src/index.css`
- `apps/popup/tailwind.config.js`

---

### Task 1: Versioned Acrylic theme contract and migration

**Files:**
- Create: `packages/contracts/src/theme.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `ThemeConfigV2`, `ThemeConfigV2Schema`, `AcrylicPresetId`, `DEFAULT_ACRYLIC_THEME`, `migrateThemeConfig`.

- [ ] **Step 1: Write failing default/migration tests**

```ts
it("uses Acrylic Sage defaults", () => {
  expect(DEFAULT_ACRYLIC_THEME).toMatchObject({
    version: 2,
    preset: "acrylic-sage",
    tint: "#7e994a",
    outerOpacity: 48,
    blurPx: 30,
    saturation: 1.15,
    moduleDarkness: 78,
  });
});

it("migrates v1 local theme values", () => {
  expect(migrateThemeConfig({ accentColor: "#a78bfa", glassOpacity: 45, blurIntensity: 24 }))
    .toMatchObject({ version: 2, tint: "#a78bfa", outerOpacity: 45, blurPx: 24 });
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm exec vitest run packages/contracts/src/__tests__/theme.test.ts`.

- [ ] **Step 3: Implement bounded schema**

```ts
export const ThemeConfigV2Schema = z.object({
  version: z.literal(2),
  preset: z.enum(["acrylic-sage", "frost-blue", "neon-violet", "warm-amber", "rose-smoke", "custom"]),
  tint: z.string().regex(/^#[0-9a-f]{6}$/i),
  outerOpacity: z.number().min(20).max(80),
  blurPx: z.number().min(8).max(48),
  saturation: z.number().min(0.8).max(1.5),
  moduleDarkness: z.number().min(55).max(92),
  borderStrength: z.number().min(0).max(40),
  glowStrength: z.number().min(0).max(50),
  clockStyle: z.enum(["digital", "minimal"]),
});
```

- [ ] **Step 4: Export, run tests/typecheck, and commit**

Commit: `feat(theme): add versioned Acrylic theme contract`.

---

### Task 2: Persist and broadcast theme settings

**Files:**
- Modify: `apps/daemon/src/state/database.ts`
- Modify: `apps/daemon/src/state/presence-store.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/src/__tests__/theme-settings-api.test.ts`

**Interfaces:**
- Produces: `getThemeConfig`, `setThemeConfig`, `GET/PUT /api/settings/theme`, `settings.theme.changed` daemon event.

- [ ] **Step 1: Write failing API tests**

Assert default GET, valid PUT persistence, invalid opacity/tint 400 response, migration from v1 KV, and emitted change event.

- [ ] **Step 2: Add typed store methods**

```ts
public getThemeConfig(): ThemeConfigV2 {
  const raw = this.database?.getKv("theme-config");
  return migrateThemeConfig(raw);
}

public setThemeConfig(config: ThemeConfigV2): void {
  this.database?.setKv("theme-config", config);
  this.emit("event", { type: "settings.theme.changed", payload: config });
}
```

- [ ] **Step 3: Add GET/PUT routes with stable error code**

Invalid writes return `{ code: "invalid_theme_config", issues }` and do not mutate the previous value.

- [ ] **Step 4: Run focused/full tests and commit**

Commit: `feat(theme): persist and broadcast Acrylic settings`.

---

### Task 3: Cross-window CSS token application

**Files:**
- Create: `apps/popup/src/lib/theme-presets.ts`
- Create: `apps/popup/src/components/AcrylicWindowShell.tsx`
- Modify: `apps/popup/src/hooks/useTheme.ts`
- Modify: `apps/popup/src/index.css`
- Modify: `apps/popup/tailwind.config.js`
- Modify: `apps/popup/src/widgets/WidgetWindowShell.tsx`
- Test: `apps/popup/src/__tests__/acrylic-theme.test.tsx`

**Interfaces:**
- Consumes: `ThemeConfigV2` and theme change event.
- Produces: `applyThemeVariables(config)`, `useTheme`, `AcrylicWindowShell`, preset map.

- [ ] **Step 1: Write failing CSS-variable tests**

```ts
const variables = themeToCssVariables(DEFAULT_ACRYLIC_THEME);
expect(variables["--acrylic-tint"]).toBe("126 153 74");
expect(variables["--acrylic-opacity"]).toBe("0.48");
expect(variables["--module-bg"]).toBe("rgb(7 11 12 / 0.78)");
```

Render `AcrylicWindowShell` and assert distinct `acrylic-shell` and `module-surface` classes.

- [ ] **Step 2: Implement preset constants**

```ts
export const ACRYLIC_PRESETS = {
  "acrylic-sage": { tint: "#7e994a", outerOpacity: 48, blurPx: 30, saturation: 1.15 },
  "frost-blue": { tint: "#668fb5", outerOpacity: 46, blurPx: 32, saturation: 1.1 },
  "neon-violet": { tint: "#8064b8", outerOpacity: 44, blurPx: 30, saturation: 1.2 },
  "warm-amber": { tint: "#a47d45", outerOpacity: 48, blurPx: 28, saturation: 1.14 },
  "rose-smoke": { tint: "#9d687b", outerOpacity: 46, blurPx: 30, saturation: 1.1 },
} as const;
```

- [ ] **Step 3: Replace old glass tokens**

Define `.acrylic-shell` for outer window and `.module-surface` for dark inner cards. Keep `.glass-*` only as migration aliases during this task; remove aliases after every component is migrated.

- [ ] **Step 4: Implement cross-window update flow**

`useTheme` loads from API, applies cached default immediately, listens for daemon WebSocket events, and uses `BroadcastChannel("presenced-theme")` as same-process immediate fan-out. On daemon failure it exposes `degraded: true` while retaining cached tokens.

- [ ] **Step 5: Run tests/build and commit**

```bash
pnpm exec vitest run apps/popup/src/__tests__/acrylic-theme.test.tsx
pnpm run typecheck
pnpm run test
pnpm --filter @presenced/popup run build
```

Commit: `feat(theme): apply Acrylic Sage across widget windows`.

---

### Task 4: Complete Theme Settings

**Files:**
- Modify: `apps/popup/src/settings/ThemeSettings.tsx`
- Modify: `apps/popup/src/settings/SettingsPanel.tsx`
- Test: `apps/popup/src/__tests__/theme-settings.test.tsx`

**Interfaces:**
- Consumes: typed `useTheme` API.
- Produces complete preset/manual editor with Save, Reset, and live preview.

- [ ] **Step 1: Write failing interaction tests**

Test preset selection, manual tint, every bounded slider, Reset, failed save, successful save, and visible degraded state.

- [ ] **Step 2: Implement controls**

Fields: preset, tint, opacity, blur, saturation, module darkness, border, glow, clock. Preview must use the same `AcrylicWindowShell`, not a separate approximation.

- [ ] **Step 3: Add debounced preview and explicit persistence**

Local changes preview immediately across windows; only Save persists. Cancel/reset broadcasts the canonical stored config again.

- [ ] **Step 4: Verify no-scroll widget windows and Settings scroll**

At compact, standard, tall, and wide presets, widget content must fit without scrollbars. Settings remains the sole scroll surface.

- [ ] **Step 5: Full gates, visual review, and commit**

Capture all five presets, reduced motion, main-only, and cluster views. Obtain independent review before commit `feat(theme): ship Acrylic theme editor`.

---

### Task 5: Acrylic acceptance gate

- [ ] Open main plus at least three optional windows and change each theme control; all windows update within one render cycle.
- [ ] Restart popup and daemon separately; persisted theme returns.
- [ ] Stop daemon; cached theme remains while Settings shows degraded state.
- [ ] Verify outer acrylic and inner module colors remain measurably distinct.
- [ ] Verify no widget-window document has `scrollWidth > clientWidth` or `scrollHeight > clientHeight`.
- [ ] Run full TS/Rust/Tauri gates and independent visual/accessibility review.
