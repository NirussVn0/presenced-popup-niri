import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import {
  PresenceRules,
  ManualOverride,
  DEFAULT_PRIORITIES,
  LyricsPayload,
  CountdownItem,
} from "@presenced/contracts";

export interface DatabaseOptions {
  dbPath?: string;
}

export class DatabaseManager {
  private db: DatabaseSync;
  private readonly dbPath: string;

  constructor(options: DatabaseOptions = {}) {
    this.dbPath = options.dbPath ?? DatabaseManager.getDefaultDbPath();

    // Ensure directory exists if not memory
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    if (this.dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
      } catch {
        // ignore pragma failures in unsupported environments
      }
    }
    this.initTables();
  }

  public static getDefaultDbPath(): string {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(configHome, "presenced", "presenced.db");
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lyrics_cache (
        track_key TEXT PRIMARY KEY,
        payload TEXT,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS countdowns (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        target_date TEXT NOT NULL,
        category TEXT NOT NULL,
        icon TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        show_on_discord INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  public getRules(): PresenceRules {
    const defaultRules: PresenceRules = {
      priorities: { ...DEFAULT_PRIORITIES },
      appRules: {},
      privacyMode: false,
    };

    try {
      const row = this.db.prepare("SELECT value FROM kv_store WHERE key = ?").get("rules") as
        | { value: string }
        | undefined;

      if (!row) {
        return defaultRules;
      }

      const parsed = JSON.parse(row.value) as PresenceRules;
      return {
        priorities: { ...DEFAULT_PRIORITIES, ...(parsed.priorities || {}) },
        appRules: parsed.appRules || {},
        privacyMode: Boolean(parsed.privacyMode),
      };
    } catch {
      return defaultRules;
    }
  }

  public saveRules(rules: PresenceRules): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run("rules", JSON.stringify(rules), Date.now());
  }

  public getKv(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM kv_store WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  public getKvParsed<T>(key: string, schema: z.ZodType<T>): T | undefined {
    try {
      const value = this.getKv(key);
      if (value === undefined) return undefined;
      const parsed = schema.safeParse(JSON.parse(value));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  public setKv(key: string, value: unknown): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(key, JSON.stringify(value), Date.now());
  }

  public getPrivacyMode(): boolean {
    try {
      const row = this.db.prepare("SELECT value FROM kv_store WHERE key = ?").get("privacy_mode") as
        | { value: string }
        | undefined;
      return row ? JSON.parse(row.value) === true : false;
    } catch {
      return false;
    }
  }

  public savePrivacyMode(enabled: boolean): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run("privacy_mode", JSON.stringify(enabled), Date.now());
  }

  public getManualOverride(): ManualOverride | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM kv_store WHERE key = ?")
        .get("manual_override") as { value: string } | undefined;
      if (!row) return null;
      const override = JSON.parse(row.value) as ManualOverride;
      // Check expiry
      if (override.expiresAt && override.expiresAt < Date.now()) {
        this.saveManualOverride(null);
        return null;
      }
      return override;
    } catch {
      return null;
    }
  }

  public saveManualOverride(override: ManualOverride | null): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run("manual_override", JSON.stringify(override), Date.now());
  }

  public getLyrics(trackKey: string): LyricsPayload | null {
    try {
      const row = this.db
        .prepare("SELECT payload, expires_at FROM lyrics_cache WHERE track_key = ?")
        .get(trackKey) as { payload: string | null; expires_at: number } | undefined;

      if (!row || row.expires_at < Date.now()) {
        return null;
      }

      return row.payload ? (JSON.parse(row.payload) as LyricsPayload) : null;
    } catch {
      return null;
    }
  }

  public saveLyrics(trackKey: string, payload: LyricsPayload | null, expiresAt: number): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO lyrics_cache (track_key, payload, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(track_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
      `);
      stmt.run(trackKey, payload ? JSON.stringify(payload) : null, expiresAt);
    } catch {
      // ignore
    }
  }

  public getCountdowns(): CountdownItem[] {
    try {
      const rows = this.db.prepare("SELECT * FROM countdowns ORDER BY target_date ASC").all() as any[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        targetDate: r.target_date,
        category: r.category,
        icon: r.icon || undefined,
        enabled: Boolean(r.enabled),
        showOnDiscord: Boolean(r.show_on_discord),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch {
      return [];
    }
  }

  public saveCountdown(item: CountdownItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO countdowns (id, title, target_date, category, icon, enabled, show_on_discord, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        target_date = excluded.target_date,
        category = excluded.category,
        icon = excluded.icon,
        enabled = excluded.enabled,
        show_on_discord = excluded.show_on_discord,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      item.id,
      item.title,
      item.targetDate,
      item.category,
      item.icon || null,
      item.enabled ? 1 : 0,
      item.showOnDiscord ? 1 : 0,
      item.createdAt,
      item.updatedAt
    );
  }

  public deleteCountdown(id: string): void {
    this.db.prepare("DELETE FROM countdowns WHERE id = ?").run(id);
  }

  // ── Discord config (KV store) ──────────────────────────────────────────

  public getDiscordConfig(): { clientId?: string; socketPath?: string } {
    try {
      const row = this.db
        .prepare("SELECT value FROM kv_store WHERE key = ?")
        .get("discord_config") as { value: string } | undefined;
      if (!row) return {};
      return JSON.parse(row.value);
    } catch {
      return {};
    }
  }

  public saveDiscordConfig(config: { clientId?: string; socketPath?: string }): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run("discord_config", JSON.stringify(config), Date.now());
  }

  // ── RVC Rotation config (KV store) ────────────────────────────────────

  public getRvcConfig(): { enabled: boolean; tickIntervalSec: number; entries: any[] } | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM kv_store WHERE key = ?")
        .get("rvc_config") as { value: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  public saveRvcConfig(config: { enabled: boolean; tickIntervalSec: number; entries: any[] }): void {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run("rvc_config", JSON.stringify(config), Date.now());
  }

  public close(): void {
    this.db.close();
  }
}
