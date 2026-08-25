import * as fs from "node:fs";
import * as path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import {
  PresenceSnapshot,
  ManualOverride,
  ManualOverrideSchema,
  PresenceRulesSchema,
  DaemonEvent,
  ClusterLayoutV1Schema,
  ThemeSettingsV1Schema,
} from "@presenced/contracts";
import { PresenceStore } from "../state/presence-store.js";
import { PomodoroEngine } from "../sources/pomodoro/pomodoro-engine.js";
import { CountdownEngine } from "../sources/countdown/countdown-engine.js";
import { MprisSource } from "../sources/mpris/mpris-source.js";
import { TokenManager } from "../auth/token-manager.js";

const TRUSTED_TAURI_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

function isTrustedLocalOrigin(origin: string): boolean {
  if (TRUSTED_TAURI_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export interface ApiServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  store: PresenceStore;
  pomodoroEngine?: PomodoroEngine;
  countdownEngine?: CountdownEngine;
  mprisSource?: MprisSource;
  tokenManager?: TokenManager;
}

export class ApiServer {
  private server: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private readonly store: PresenceStore;
  private readonly pomodoroEngine: PomodoroEngine | null = null;
  private readonly countdownEngine: CountdownEngine | null = null;
  private readonly mprisSource: MprisSource | null = null;
  private readonly tokenManager: TokenManager | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly staticDir: string | null;
  private readonly app: Hono;
  private unsubscribeStore: (() => void) | null = null;

  constructor(options: ApiServerOptions) {
    this.store = options.store;
    this.pomodoroEngine = options.pomodoroEngine ?? null;
    this.countdownEngine = options.countdownEngine ?? null;
    this.mprisSource = options.mprisSource ?? null;
    this.tokenManager = options.tokenManager ?? null;
    this.port = options.port ?? 4242;
    this.host = options.host ?? "127.0.0.1";
    this.staticDir = options.staticDir ?? ApiServer.findDefaultStaticDir();
    this.app = new Hono();

    this.setupRoutes();
  }

  private static findDefaultStaticDir(): string | null {
    const candidates = [
      path.resolve(process.cwd(), "apps/web/dist"),
      path.resolve(process.cwd(), "../web/dist"),
      path.resolve(process.cwd(), "dist/web"),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.existsSync(path.join(cand, "index.html"))) {
        return cand;
      }
    }
    return null;
  }

  private setupRoutes(): void {
    // Allow loopback web frontend
    this.app.use(
      "/*",
      cors({
        origin: (origin) => {
          return origin && isTrustedLocalOrigin(origin) ? origin : null;
        },
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      })
    );

    // Health endpoint
    this.app.get("/api/health", (c) => {
      return c.json({
        status: "ok",
        health: this.store.getHealth(),
        uptime: process.uptime(),
      });
    });

    // State snapshot endpoint
    this.app.get("/api/state", (c) => {
      return c.json<PresenceSnapshot>(this.store.getSnapshot());
    });

    // Manual override endpoints
    this.app.post("/api/override", async (c) => {
      try {
        const body = await c.req.json();
        const expiresAt = body.durationSeconds
          ? Date.now() + body.durationSeconds * 1000
          : body.expiresAt;

        const override: ManualOverride = {
          id: `override-${Date.now()}`,
          category: body.category ?? "manual",
          title: body.title,
          details: body.details,
          state: body.state,
          expiresAt,
          createdAt: Date.now(),
        };

        const parsed = ManualOverrideSchema.safeParse(override);
        if (!parsed.success) {
          return c.json({ error: "Invalid override payload", details: parsed.error }, 400);
        }

        this.store.setManualOverride(parsed.data);
        return c.json(this.store.getSnapshot());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    this.app.delete("/api/override", (c) => {
      this.store.setManualOverride(null);
      return c.json(this.store.getSnapshot());
    });

    // Privacy mode toggle
    this.app.post("/api/privacy", async (c) => {
      try {
        const body = await c.req.json();
        const enabled = Boolean(body.enabled);
        this.store.setPrivacyMode(enabled);
        return c.json(this.store.getSnapshot());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    // Scene endpoints
    this.app.get("/api/scene", (c) => {
      const snapshot = this.store.getSnapshot();
      return c.json({
        activeScene: snapshot.scene,
        sceneType: this.store.getSceneType(),
      });
    });

    this.app.post("/api/scene", async (c) => {
      try {
        const body = await c.req.json();
        const sceneType = body.sceneType;
        if (!sceneType || typeof sceneType !== "string") {
          return c.json({ error: "Invalid sceneType" }, 400);
        }
        this.store.setScene(sceneType as any);
        return c.json(this.store.getSnapshot());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    // Pomodoro endpoints
    this.app.post("/api/pomodoro/start", async (c) => {
      try {
        const body = await c.req.json();
        if (this.pomodoroEngine) {
          this.pomodoroEngine.start(body.taskName, body.durationMinutes);
        }
        return c.json(this.store.getSnapshot());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    this.app.post("/api/pomodoro/pause", (c) => {
      this.pomodoroEngine?.pause();
      return c.json(this.store.getSnapshot());
    });

    this.app.post("/api/pomodoro/resume", (c) => {
      this.pomodoroEngine?.resume();
      return c.json(this.store.getSnapshot());
    });

    this.app.post("/api/pomodoro/stop", (c) => {
      this.pomodoroEngine?.stop();
      return c.json(this.store.getSnapshot());
    });

    this.app.post("/api/pomodoro/skip", (c) => {
      this.pomodoroEngine?.skip();
      return c.json(this.store.getSnapshot());
    });

    // Countdown endpoints
    this.app.get("/api/countdowns", (c) => {
      if (!this.countdownEngine) {
        return c.json({ countdowns: [], activeFact: null });
      }
      return c.json({
        activeFact: this.countdownEngine.getFact(),
      });
    });

    this.app.post("/api/countdowns", async (c) => {
      try {
        const body = await c.req.json();
        if (this.countdownEngine) {
          const item = this.countdownEngine.addCountdown({
            title: body.title,
            targetDate: body.targetDate,
            category: body.category ?? "personal",
            icon: body.icon,
            enabled: body.enabled ?? true,
            showOnDiscord: body.showOnDiscord ?? false,
          });
          return c.json({ item, snapshot: this.store.getSnapshot() });
        }
        return c.json(this.store.getSnapshot());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    this.app.delete("/api/countdowns/:id", (c) => {
      const id = c.req.param("id");
      this.countdownEngine?.removeCountdown(id);
      return c.json(this.store.getSnapshot());
    });

    this.app.post("/api/countdowns/:id/toggle", (c) => {
      const id = c.req.param("id");
      this.countdownEngine?.toggleCountdown(id);
      return c.json(this.store.getSnapshot());
    });

    // Media playback controls
    this.app.post("/api/media/play-pause", (c) => {
      this.mprisSource?.playPause();
      return c.json({ success: true });
    });

    this.app.post("/api/media/next", (c) => {
      this.mprisSource?.next();
      return c.json({ success: true });
    });

    this.app.post("/api/media/previous", (c) => {
      this.mprisSource?.previous();
      return c.json({ success: true });
    });

    // Rules endpoints
    this.app.get("/api/rules", (c) => {
      return c.json(this.store.getRules());
    });

    // Theme settings endpoints
    this.app.get("/api/theme", (c) => {
      return c.json(this.store.getThemeSettings());
    });

    this.app.put("/api/theme", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_theme_config" }, 400);
      }

      const parsed = ThemeSettingsV1Schema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_theme_config" }, 400);
      }
      const saved = this.store.setThemeSettings(parsed.data);
      return c.json(saved);
    });

    // Discord config endpoints
    this.app.get("/api/settings/discord", (c) => {
      return c.json(this.store.getDiscordConfig());
    });

    // Widget layout endpoints
    this.app.get("/api/settings/widgets", (c) => {
      return c.json(this.store.getWidgetLayout());
    });

    this.app.put("/api/settings/widgets", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ code: "invalid_widget_layout", issues: [] }, 400);
      }

      const parsed = ClusterLayoutV1Schema.safeParse(body);
      if (!parsed.success) {
        return c.json({ code: "invalid_widget_layout", issues: parsed.error.issues }, 400);
      }
      this.store.setWidgetLayout(parsed.data);
      return c.json(parsed.data);
    });

    this.app.post("/api/settings/discord", async (c) => {
      try {
        const body = await c.req.json();
        this.store.setDiscordConfig({
          clientId: body.clientId || undefined,
          socketPath: body.socketPath || undefined,
        });
        return c.json({ ok: true });
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    // RVC Rotation config endpoints
    this.app.get("/api/settings/rvc", (c) => {
      const config = this.store.getRvcConfig();
      return c.json(config ?? { enabled: false, tickIntervalSec: 30, entries: [] });
    });

    this.app.post("/api/settings/rvc", async (c) => {
      try {
        const body = await c.req.json();
        this.store.setRvcConfig({
          enabled: Boolean(body.enabled),
          tickIntervalSec: Number(body.tickIntervalSec) || 30,
          entries: Array.isArray(body.entries) ? body.entries : [],
        });
        return c.json({ ok: true });
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    this.app.put("/api/rules", async (c) => {
      try {
        const body = await c.req.json();
        const parsed = PresenceRulesSchema.safeParse(body);
        if (!parsed.success) {
          return c.json({ error: "Invalid rules payload", details: parsed.error }, 400);
        }
        this.store.setRules(parsed.data);
        return c.json(this.store.getRules());
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
    });

    // Static web dashboard assets
    if (this.staticDir) {
      const staticDir = this.staticDir;
      this.app.get("/*", (c) => {
        const reqPath = c.req.path;
        if (reqPath.startsWith("/api")) {
          return c.text("Not Found", 404);
        }
        let filePath = path.join(staticDir, reqPath === "/" ? "index.html" : reqPath);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(staticDir, "index.html");
        }
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          let contentType = "text/html";
          if (ext === ".js") contentType = "application/javascript";
          else if (ext === ".css") contentType = "text/css";
          else if (ext === ".svg") contentType = "image/svg+xml";
          else if (ext === ".json") contentType = "application/json";
          else if (ext === ".png") contentType = "image/png";
          else if (ext === ".webp") contentType = "image/webp";
          else if (ext === ".ico") contentType = "image/x-icon";
          else if (ext === ".woff2") contentType = "font/woff2";
          else if (ext === ".woff") contentType = "font/woff";
          else if (ext === ".ttf") contentType = "font/ttf";

          return c.body(content, 200, { "Content-Type": contentType });
        }
        return c.text("presenced dashboard not built", 404);
      });
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      const server = serve(
        {
          fetch: this.app.fetch,
          port: this.port,
          hostname: this.host,
        },
        () => {
          resolve();
        }
      ) as HttpServer;

      this.server = server;
      this.initWebSocket(server);
      this.subscribeStore();
    });
  }

  private initWebSocket(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      path: "/api/events",
      verifyClient: ({ origin }, done) => {
        if (!origin || isTrustedLocalOrigin(origin)) {
          done(true);
          return;
        }
        done(false, 403, "Forbidden");
      },
    });

    this.wss.on("connection", (ws: WebSocket) => {
      // Send initial snapshot
      const initialEvent: DaemonEvent = {
        type: "state.snapshot",
        payload: this.store.getSnapshot(),
      };
      ws.send(JSON.stringify(initialEvent));

      ws.on("message", (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
          }
        } catch {
          // ignore
        }
      });
    });
  }

  private subscribeStore(): void {
    const onStoreEvent = (event: DaemonEvent) => {
      if (!this.wss) return;
      const data = JSON.stringify(event);
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(data);
          } catch {
            // ignore
          }
        }
      }
    };

    this.store.on("event", onStoreEvent);
    this.unsubscribeStore = () => {
      this.store.off("event", onStoreEvent);
    };
  }

  public async stop(): Promise<void> {
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  public getPort(): number {
    if (this.server) {
      const addr = this.server.address();
      if (addr && typeof addr === "object") {
        return addr.port;
      }
    }
    return this.port;
  }

  public getApp(): Hono {
    return this.app;
  }
}
