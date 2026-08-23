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
  - `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`
  - Result: 1 test file passed, 4 tests passed.
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
  - `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts -t "malformed JSON"`
  - Result: `1 failed, 4 skipped`; received HTTP `500`, expected `400`.
- Focused GREEN run:
  - `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`
  - Result: `1 test file passed`; `5 tests passed`.
- Typecheck:
  - `pnpm run typecheck`
  - Result: contracts, core, daemon, popup, and web typechecks all passed.
- Diff validation:
  - `git diff --check`
  - Result: passed with no output.
- Restored incidental `tsconfig.tsbuildinfo` changes; final diff contains only the widget-layout test, API route, and this report.

## Fix Round 2: Persistence Error Classification

### Status

Implemented and verified. The JSON parsing `try/catch` now covers only `await c.req.json()`. Schema validation and `setWidgetLayout()` execute outside that catch, so persistence exceptions propagate through the existing Hono server behavior as HTTP 500 instead of being misclassified as invalid JSON.

### Changes

- Modified `apps/daemon/src/api/server.ts` to narrow the parsing catch scope while preserving HTTP 400 with `{ code: "invalid_widget_layout", issues: [] }` for malformed JSON.
- Modified `apps/daemon/src/__tests__/widget-layout-api.test.ts` with a deterministic mocked `setWidgetLayout()` failure regression test asserting HTTP 500 and `Internal Server Error`.

### Verification

- Focused regression and API suite:
  - `pnpm exec vitest run apps/daemon/src/__tests__/widget-layout-api.test.ts`
  - Result: 1 test file passed, 6 tests passed.
- Typecheck:
  - `pnpm run typecheck`
  - Result: contracts, core, daemon, popup, and web typechecks all passed.
- Full test suite:
  - `pnpm run test`
  - Result: 44 test files passed, 142 tests passed.
- Diff validation:
  - `git diff --check`
  - Result: passed with no output.
- Worktree/main-checkout safety:
  - Worktree changes were limited to the intended API route, regression test, and this report; the main checkout remained clean.

### Self-review

- Malformed JSON still returns the required typed HTTP 400 response.
- Schema-invalid but valid JSON still returns HTTP 400 with schema issues.
- Valid JSON reaching a failing persistence call now remains HTTP 500.
- Existing assertions were retained; the new test adds the missing distinction without weakening coverage.

### Concerns

- The regression test intentionally emits the expected uncaught persistence error to Vitest stderr while asserting the HTTP 500 response; this is existing server error behavior, not a test failure.
- No other concerns.
