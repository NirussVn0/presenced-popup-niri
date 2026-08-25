/**
 * useTheme — theme sourced from the daemon API, cached in localStorage.
 *
 * Source of truth: GET/PUT http://127.0.0.1:4242/api/theme plus the
 * theme.settings.changed WebSocket broadcast. localStorage holds ONLY the
 * last-known cache so popups can keep rendering when the daemon is down.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DaemonEventSchema,
  DEFAULT_THEME_SETTINGS,
  migrateThemeSettings,
  ThemeSettingsV1,
} from "@presenced/contracts";

const API_HTTP_URL = "http://127.0.0.1:4242/api";
const API_WS_URL = "ws://127.0.0.1:4242/api/events";

/** Legacy-compatible alias: the v1 theme contract shape. */
export type ThemeConfig = Omit<ThemeSettingsV1, "version">;

/** Kept for existing consumers; identical values to the v1 contract default. */
export const DEFAULT_THEME: ThemeConfig = {
  accentColor: DEFAULT_THEME_SETTINGS.accentColor,
  glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
  blurIntensity: DEFAULT_THEME_SETTINGS.blurIntensity,
  borderStyle: DEFAULT_THEME_SETTINGS.borderStyle,
  clockStyle: DEFAULT_THEME_SETTINGS.clockStyle,
};

const THEME_CACHE_KEY = "presenced-theme-v1";
const RECONNECT_MS = 2000;

export function normalizeHex(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_THEME.accentColor;
}

export function hexToRgb(color: string): [number, number, number] {
  const normalized = normalizeHex(color).slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function readRawCache(): unknown {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadCachedTheme(): ThemeConfig {
  const migrated = migrateThemeSettings(readRawCache());
  const { version: _version, ...rest } = migrated;
  return rest;
}

function writeCachedTheme(theme: ThemeConfig): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ ...theme, version: 1 }));
  } catch {
    // cache write failures must never break theming
  }
}

export function applyTheme(config: ThemeConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(config.accentColor);
  root.style.setProperty("--accent-color", config.accentColor);
  root.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  root.style.setProperty("--glass-alpha", String(config.glassOpacity / 100));
  root.style.setProperty("--glass-alpha-strong", String(Math.min(0.9, config.glassOpacity / 100 + 0.1)));
  root.style.setProperty("--glass-alpha-float", String(Math.max(0.1, config.glassOpacity / 100 - 0.1)));
  root.style.setProperty("--glass-blur", `${config.blurIntensity}px`);
  root.style.setProperty("--glass-blur-strong", `${Math.min(48, config.blurIntensity + 8)}px`);
  root.dataset.themeBorder = config.borderStyle;
}

async function fetchThemeFromDaemon(): Promise<ThemeSettingsV1 | null> {
  try {
    const res = await fetch(`${API_HTTP_URL}/theme`);
    if (!res.ok) return null;
    return migrateThemeSettings(await res.json());
  } catch {
    return null;
  }
}

function stripVersion(theme: ThemeSettingsV1): ThemeConfig {
  const { version: _version, ...rest } = theme;
  return rest;
}

function sameTheme(a: ThemeConfig, b: ThemeConfig): boolean {
  return (
    a.accentColor === b.accentColor &&
    a.glassOpacity === b.glassOpacity &&
    a.blurIntensity === b.blurIntensity &&
    a.borderStyle === b.borderStyle &&
    a.clockStyle === b.clockStyle
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeConfig>(loadCachedTheme);
  const [degraded, setDegraded] = useState<boolean>(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const migratedLegacyThemeRef = useRef(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * One-time migration: if the daemon still serves defaults while the local
   * cache carries an older customized theme, push the migrated cache up once.
   */
  const syncWithDaemon = useCallback(async (): Promise<void> => {
    const remote = await fetchThemeFromDaemon();
    if (!remote) {
      setDegraded(true);
      return;
    }

    let next = remote;
    if (!migratedLegacyThemeRef.current) {
      migratedLegacyThemeRef.current = true;
      const legacyMigrated = migrateThemeSettings(readRawCache());
      if (!sameTheme(stripVersion(legacyMigrated), DEFAULT_THEME) && sameTheme(stripVersion(remote), DEFAULT_THEME)) {
        try {
          const res = await fetch(`${API_HTTP_URL}/theme`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(legacyMigrated),
          });
          if (res.ok) {
            const saved = migrateThemeSettings(await res.json());
            next = saved;
          }
        } catch {
          // daemon unreachable again — stay degraded with cached rendering
        }
      }
    }

    const nextConfig = stripVersion(next);
    writeCachedTheme(nextConfig);
    setTheme((prev) => (sameTheme(prev, nextConfig) ? prev : nextConfig));
    setDegraded(false);
  }, []);

  useEffect(() => {
    void syncWithDaemon();

    if (typeof WebSocket === "undefined") return;

    const connectWebSocket = () => {
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      try {
        const ws = new WebSocket(API_WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          void syncWithDaemon();
        };

        ws.onmessage = (event) => {
          try {
            const parsed = DaemonEventSchema.safeParse(JSON.parse(event.data));
            if (!parsed.success || parsed.data.type !== "theme.settings.changed") return;
            const nextConfig = stripVersion(parsed.data.payload);
            writeCachedTheme(nextConfig);
            setTheme((prev) => (sameTheme(prev, nextConfig) ? prev : nextConfig));
            setDegraded(false);
          } catch {
            // ignore malformed frames
          }
        };

        ws.onclose = () => {
          setDegraded(true);
          wsRef.current = null;
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_MS);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setDegraded(true);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_MS);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [syncWithDaemon]);

  /** Current known theme (daemon value when reachable, cache otherwise). */
  const loadTheme = useCallback(async (): Promise<ThemeConfig> => themeRef.current, []);

  /** Explicit persist: PUT to the daemon and keep the cache warm either way. */
  const saveTheme = useCallback(async (next: ThemeConfig): Promise<void> => {
    const normalized = stripVersion(
      migrateThemeSettings({ ...next, accentColor: normalizeHex(next.accentColor) })
    );
    writeCachedTheme(normalized);
    setTheme(normalized);
    try {
      const res = await fetch(`${API_HTTP_URL}/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...normalized, version: 1 }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      setDegraded(false);
    } catch {
      setDegraded(true);
    }
  }, []);

  return { theme, loadTheme, saveTheme, degraded };
}
