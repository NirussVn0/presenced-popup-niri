import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { PresenceStore } from "../state/presence-store.js";
import { ApiServer } from "../api/server.js";
import { DesktopFact, DaemonEvent } from "@presenced/contracts";

describe("API & WebSocket Server", () => {
  let store: PresenceStore;
  let server: ApiServer;

  beforeEach(async () => {
    store = new PresenceStore({ focusDebounceMs: 0 });
    server = new ApiServer({ port: 0, host: "127.0.0.1", store });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    store.stop();
  });

  it("handles GET /api/health and GET /api/state via HTTP app", async () => {
    const app = server.getApp();

    const healthRes = await app.request("/api/health");
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe("ok");

    const stateRes = await app.request("/api/state");
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();
    expect(stateJson.privacyMode).toBe(false);
  });

  it("allows setting and deleting manual override via HTTP", async () => {
    const app = server.getApp();

    const postRes = await app.request("/api/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Deep Focus",
        category: "manual",
        details: "Solving problems",
      }),
    });

    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.presence?.title).toBe("Deep Focus");
    expect(postJson.override?.title).toBe("Deep Focus");

    const deleteRes = await app.request("/api/override", { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    const deleteJson = await deleteRes.json();
    expect(deleteJson.override).toBeNull();
  });

  it("sends initial snapshot on WebSocket connect and broadcasts live events", async () => {
    const activePort = server.getPort();
    const ws = new WebSocket(`ws://127.0.0.1:${activePort}/api/events`);
    const receivedEvents: DaemonEvent[] = [];

    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      receivedEvents.push(parsed);
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    // Wait for initial snapshot event
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvents[0]?.type).toBe("state.snapshot");

    // Trigger a desktop change
    const desktopFact: DesktopFact = {
      kind: "desktop",
      appId: "code",
      observedAt: Date.now(),
    };
    store.setDesktop(desktopFact, true);

    // Wait for broadcast
    await new Promise((resolve) => setTimeout(resolve, 80));
    const presenceEvents = receivedEvents.filter((e) => e.type === "presence.resolved");
    expect(presenceEvents.length).toBe(1);
    expect(presenceEvents[0]?.payload?.category).toBe("coding");

    ws.close();
  });

  it.each([
    "tauri://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("allows the trusted WebSocket origin %s", async (origin) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}/api/events`, {
      headers: { Origin: origin },
    });
    const initialEvent = new Promise<DaemonEvent>((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
    });

    await expect(initialEvent).resolves.toMatchObject({ type: "state.snapshot" });
    ws.close();
  });

  it("rejects hostile WebSocket origins before sending state", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}/api/events`, {
      headers: { Origin: "https://evil.example" },
    });
    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.once("open", () => reject(new Error("hostile WebSocket origin connected")));
      ws.once("error", () => undefined);
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
    });

    expect(statusCode).toBe(403);
  });
});
