import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ClusterLayoutV1, DEFAULT_CLUSTER_LAYOUT } from "@presenced/contracts";
import { ApiServer } from "../api/server.js";
import { DatabaseManager } from "../state/database.js";
import { PresenceStore } from "../state/presence-store.js";

describe("Widget layout API", () => {
  let tempDir: string;
  let database: DatabaseManager;
  let store: PresenceStore;
  let server: ApiServer;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "presenced-widget-layout-"));
    database = new DatabaseManager({ dbPath: path.join(tempDir, "presenced.db") });
    store = new PresenceStore({ database, focusDebounceMs: 0 });
    server = new ApiServer({ port: 0, host: "127.0.0.1", store });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    store.stop();
    database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the default layout from GET /api/settings/widgets", async () => {
    const response = await server.getApp().request("/api/settings/widgets");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFAULT_CLUSTER_LAYOUT);
  });

  it("persists and returns a validated layout from PUT /api/settings/widgets", async () => {
    const layout: ClusterLayoutV1 = {
      version: 1,
      leftVisible: true,
      rightVisible: true,
      editMode: false,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "wide", visible: true },
      ],
    };

    const response = await server.getApp().request("/api/settings/widgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(layout);
  });

  it("returns a typed 400 error for malformed JSON", async () => {
    const response = await server.getApp().request("/api/settings/widgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_widget_layout" });
  });

  it("rejects duplicate widget placements with a typed 400 error", async () => {
    const response = await server.getApp().request("/api/settings/widgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...DEFAULT_CLUSTER_LAYOUT,
        placements: [
          { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
          { widgetId: "music", side: "right", order: 1, lane: "bottom", size: "compact", visible: true },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_widget_layout" });
  });

  it("loads the saved layout through a new store instance", async () => {
    const layout: ClusterLayoutV1 = {
      ...DEFAULT_CLUSTER_LAYOUT,
      leftVisible: true,
      placements: [
        { widgetId: "lyrics", side: "left", order: 0, lane: "middle", size: "tall", visible: true },
      ],
    };

    const putResponse = await server.getApp().request("/api/settings/widgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout),
    });
    expect(putResponse.status).toBe(200);

    const nextDatabase = new DatabaseManager({ dbPath: path.join(tempDir, "presenced.db") });
    const nextStore = new PresenceStore({ database: nextDatabase, focusDebounceMs: 0 });
    expect(nextStore.getWidgetLayout()).toEqual(layout);
    nextStore.stop();
    nextDatabase.close();
  });
});
