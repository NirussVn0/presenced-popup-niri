import { createRequire } from "node:module";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
});

const { act, create } = createRequire(import.meta.url)(
  "react-test-renderer/cjs/react-test-renderer.development.js",
) as typeof import("react-test-renderer");

import { useTheme } from "../hooks/useTheme.js";
import type { ThemeConfig } from "../hooks/useTheme.js";

type UseThemeState = ReturnType<typeof useTheme>;

const DEFAULTS = {
  accentColor: "#7c8aff",
  glassOpacity: 45,
  blurIntensity: 24,
  borderStyle: "subtle",
  clockStyle: "digital",
};

const CUSTOM: ThemeConfig = {
  accentColor: "#34d399",
  glassOpacity: 60,
  blurIntensity: 18,
  borderStyle: "neon",
  clockStyle: "minimal",
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

let fetchHandler: FetchHandler | null = null;
const storage = new Map<string, string>();

function makeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  } as unknown as Response;
}

function flush(times = 4): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    p = p.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  return p;
}

function renderUseTheme(): { renderer: ReactTestRenderer; getState: () => UseThemeState } {
  let state: UseThemeState | undefined;
  const TestComponent = () => {
    state = useTheme();
    return null;
  };
  const renderer = create(<TestComponent />);
  return { renderer, getState: () => state! };
}

async function mountUseTheme(): Promise<{
  renderer: ReactTestRenderer;
  getState: () => UseThemeState;
}> {
  let mounted: ReturnType<typeof renderUseTheme> | undefined;
  await act(async () => {
    mounted = renderUseTheme();
    await flush();
  });
  return mounted!;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  storage.clear();
  FakeWebSocket.instances = [];
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  fetchHandler = (_url) => makeResponse({ ...DEFAULTS, version: 1 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      fetchHandler!(String(input), init)
    ) as unknown as typeof fetch,
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await flush(1);
});

describe("useTheme daemon contract", () => {
  it("syncs from the daemon and clears the degraded flag on success", async () => {
    const { renderer, getState } = await mountUseTheme();

    expect(getState().degraded).toBe(false);
    expect(getState().theme.accentColor).toBe("#7c8aff");
    await act(async () => renderer.unmount());
  });

  it("keeps the cached theme and reports degradation when the daemon is down", async () => {
    storage.set("presenced-theme-v1", JSON.stringify({ ...CUSTOM, version: 1 }));
    fetchHandler = () => Promise.reject(new Error("daemon connection refused"));

    const { renderer, getState } = await mountUseTheme();

    expect(getState().degraded).toBe(true);
    expect(getState().theme).toEqual(CUSTOM);
    await act(async () => renderer.unmount());
  });

  it("resyncs over the broadcast channel and updates within one cycle", async () => {
    const { renderer, getState } = await mountUseTheme();
    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);

    const ws = FakeWebSocket.instances[0]!;
    await act(async () => ws.onopen?.());
    await act(async () => flush());

    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({ type: "theme.settings.changed", payload: { ...CUSTOM, version: 1 } }),
      });
    });

    expect(getState().theme).toEqual(CUSTOM);
    expect(storage.get("presenced-theme-v1")).toContain("#34d399");
    await act(async () => renderer.unmount());
  });

  it("flags degraded when the daemon drops the connection but keeps rendering cache", async () => {
    const { renderer, getState } = await mountUseTheme();

    const ws = FakeWebSocket.instances[0]!;
    await act(async () => ws.onclose?.());
    expect(getState().degraded).toBe(true);
    // Cached theme still rendered
    expect(getState().theme.clockStyle).toBeDefined();

    await act(async () => ws.onopen?.());
    await act(async () => flush());
    expect(getState().degraded).toBe(false);
    await act(async () => renderer.unmount());
  });

  it("migrates a customized localStorage theme once when the daemon serves defaults", async () => {
    storage.set(
      "presenced-theme-v1",
      JSON.stringify({ accentColor: "#FF0000", glassOpacity: "70" }),
    );

    // Mock behaves like the real daemon: PUT persists and GET returns stored state.
    let daemonStore: unknown = { ...DEFAULTS, version: 1 };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/theme") && init?.method === "PUT") {
        daemonStore = JSON.parse(String(init.body));
        return makeResponse(daemonStore);
      }
      return makeResponse(daemonStore);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { renderer, getState } = await mountUseTheme();

    const putCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith("/api/theme") && init?.method === "PUT",
    );
    expect(putCalls).toHaveLength(1);
    const body = JSON.parse(String(putCalls[0]![1]?.body));
    expect(body.accentColor).toBe("#ff0000");
    expect(body.glassOpacity).toBe(70);

    // Daemon accepted the migration — no repeat PUTs on resync
    await act(async () => FakeWebSocket.instances[0]!.onopen?.());
    await act(async () => flush());
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/api/theme") && init?.method === "PUT",
      ),
    ).toHaveLength(1);

    expect(getState().theme.accentColor).toBe("#ff0000");
    await act(async () => renderer.unmount());
  });

  it("does not migrate when the daemon already has a custom theme", async () => {
    storage.set(
      "presenced-theme-v1",
      JSON.stringify({ accentColor: "#FF0000", glassOpacity: "70" }),
    );
    fetchHandler = (_url) => makeResponse({ ...CUSTOM, version: 1 });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      fetchHandler!(String(input), init)
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { renderer, getState } = await mountUseTheme();

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(getState().theme).toEqual(CUSTOM);
    await act(async () => renderer.unmount());
  });

  it("keeps cached values and flags degraded when an explicit save fails", async () => {
    const { renderer, getState } = await mountUseTheme();
    expect(getState().degraded).toBe(false);

    fetchHandler = () => makeResponse({ error: "invalid_theme_config" }, false);
    await act(async () => {
      await getState().saveTheme({ ...CUSTOM });
    });

    expect(getState().degraded).toBe(true);
    // Cache retained the attempted save so the UI keeps rendering something sane
    expect(JSON.parse(storage.get("presenced-theme-v1")!).accentColor).toBe("#34d399");
    await act(async () => renderer.unmount());
  });
});
