import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import {
  DEFAULT_THEME_SETTINGS,
  ThemeSettingsV1,
  migrateThemeSettings,
} from "@presenced/contracts";
import { ApiServer } from "../api/server.js";
import { DatabaseManager } from "../state/database.js";
import { PresenceStore } from "../state/presence-store.js";

describe("Theme API", () => {
  let tempDir: string;
  let dbPath: string;
  let database: DatabaseManager;
  let store: PresenceStore;
  let server: ApiServer;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "presenced-theme-api-"));
    dbPath = path.join(tempDir, "presenced.db");
    database = new DatabaseManager({ dbPath });
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

  it("returns the default theme from GET /api/theme", async () => {
    const response = await server.getApp().request("/api/theme");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("persists a validated theme and returns the stored canonical value", async () => {
    const theme: ThemeSettingsV1 = {
      ...DEFAULT_THEME_SETTINGS,
      accentColor: "#34d399",
      glassOpacity: 60,
      blurIntensity: 18,
      borderStyle: "neon",
      clockStyle: "analog",
    };

    const putResponse = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme),
    });

    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual(theme);

    const getResponse = await server.getApp().request("/api/theme");
    expect(await getResponse.json()).toEqual(theme);
  });

  it("keeps the saved theme across a daemon restart", async () => {
    const theme: ThemeSettingsV1 = {
      ...DEFAULT_THEME_SETTINGS,
      accentColor: "#fbbf24",
      glassOpacity: 30,
    };

    const putResponse = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme),
    });
    expect(putResponse.status).toBe(200);

    await server.stop();
    store.stop();
    database.close();

    const nextDatabase = new DatabaseManager({ dbPath });
    const nextStore = new PresenceStore({ database: nextDatabase, focusDebounceMs: 0 });
    expect(nextStore.getThemeSettings()).toEqual(theme);
    nextStore.stop();
    nextDatabase.close();

    database = new DatabaseManager({ dbPath });
    store = new PresenceStore({ database, focusDebounceMs: 0 });
    server = new ApiServer({ port: 0, host: "127.0.0.1", store });
    await server.start();

    const getResponse = await server.getApp().request("/api/theme");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual(theme);
  });

  it.each([
    { ...DEFAULT_THEME_SETTINGS, glassOpacity: 101 },
    { ...DEFAULT_THEME_SETTINGS, accentColor: "#12345" },
    { ...DEFAULT_THEME_SETTINGS, borderStyle: "chunky" },
    { version: 2 },
    "not-an-object",
  ])("rejects an invalid theme payload with 400 invalid_theme_config: %j", async (badBody) => {
    const response = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(badBody),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_theme_config" });
  });

  it("rejects malformed JSON with 400 invalid_theme_config", async () => {
    const response = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_theme_config" });
  });

  it("broadcasts persisted theme changes to WebSocket clients", async () => {
    const theme: ThemeSettingsV1 = migrateThemeSettings({
      accentColor: "#a78bfa",
      clockStyle: "minimal",
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}/api/events`);
    const themeEvent = new Promise<{ type: string; payload: unknown }>((resolve, reject) => {
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as { type: string; payload: unknown };
        if (event.type === "theme.settings.changed") resolve(event);
      });
      ws.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const response = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme),
    });
    expect(response.status).toBe(200);

    await expect(themeEvent).resolves.toEqual({
      type: "theme.settings.changed",
      payload: theme,
    });
    const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.close();
    await closed;
  });

  it("does not emit a broadcast when the PUT is rejected", async () => {
    const onEvent = vi.fn();
    store.on("event", onEvent);

    const response = await server.getApp().request("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_THEME_SETTINGS, glassOpacity: 999 }),
    });

    expect(response.status).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
