# Cluster Task 3 Report

## Outcome

Implemented persistence of the validated cluster widget layout through the daemon's typed KV store and local API.

## Changes

- Added generic `DatabaseManager` KV helpers:
  - `getKv(key)`
  - `getKvParsed(key, schema)` with JSON and schema failure fallback
  - `setKv(key, value)` using the existing upserted `kv_store` table
- Added typed `PresenceStore` methods:
  - `getWidgetLayout()` reads `widget-layout-v1`, validates with `ClusterLayoutV1Schema`, and falls back to `DEFAULT_CLUSTER_LAYOUT`
  - `setWidgetLayout(layout)` persists the validated layout
- Added API routes:
  - `GET /api/settings/widgets`
  - `PUT /api/settings/widgets`
  - Invalid payloads return HTTP 400 with `{ code: "invalid_widget_layout", issues }`
- Added isolated API round-trip tests covering defaults, valid persistence, duplicate rejection, and reading the saved layout from a new store/database instance.

## Verification

- Focused RED run before implementation:
  - `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`
  - Expected 404 failures: 4 failed, 0 passed.
- Focused GREEN run:
  - 1 test file passed, 4 tests passed.
- Typecheck:
  - `pnpm run typecheck`
  - Passed for contracts, core, daemon, popup, and web.
- Full test suite:
  - `pnpm run test`
  - 44 test files passed, 140 tests passed.
- `git diff --check` passed.
- Incidental `tsconfig.tsbuildinfo` changes were restored.

## Files

Modified:

- `apps/daemon/src/state/database.ts`
- `apps/daemon/src/state/presence-store.ts`
- `apps/daemon/src/api/server.ts`

Created:

- `apps/daemon/src/__tests__/widget-layout-api.test.ts`

## Fix Round 1: Malformed JSON

- Added regression coverage asserting malformed JSON on `PUT /api/settings/widgets` returns HTTP 400 with the existing `{ code: "invalid_widget_layout", issues }` response shape.
- Wrapped widget-layout JSON parsing and validation in `try/catch`; JSON parse failures now return `{ code: "invalid_widget_layout", issues: [] }` with HTTP 400.

### Verification

- RED regression run:
  - Command: `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts -t "malformed JSON"`
  - Result: `1 failed, 4 skipped`; received HTTP `500`, expected `400`.
- Focused GREEN run:
  - Command: `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`
  - Result: `1 test file passed`; `5 tests passed`.
- Typecheck:
  - Command: `pnpm run typecheck`
  - Result: contracts, core, daemon, popup, and web typechecks all passed.
- Diff validation:
  - Command: `git diff --check`
  - Result: passed with no output.
- Restored incidental `tsconfig.tsbuildinfo` changes; final diff contains only the widget-layout test, API route, and this report.
