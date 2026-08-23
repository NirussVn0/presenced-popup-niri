import { createRequire } from "node:module";
import { useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import {
  DEFAULT_CLUSTER_LAYOUT,
  type ClusterLayoutV1,
} from "@presenced/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
});

const { act, create } = createRequire(import.meta.url)(
  "react-test-renderer/cjs/react-test-renderer.development.js",
) as typeof import("react-test-renderer");

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  getByLabel: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  Window: { getByLabel: tauri.getByLabel },
}));

import {
  useWindowCluster,
  type UseWindowClusterReturn,
} from "../hooks/useWindowCluster.js";

const INITIAL_LAYOUT: ClusterLayoutV1 = {
  ...DEFAULT_CLUSTER_LAYOUT,
  placements: [
    {
      widgetId: "music",
      side: "left",
      order: 0,
      lane: "top",
      size: "standard",
      visible: true,
    },
  ],
};

class ControlledWebSocket {
  static instances: ControlledWebSocket[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    ControlledWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.(new Event("open"));
  }

  message(value: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) }));
  }

  malformed(value: string) {
    this.onmessage?.(new MessageEvent("message", { data: value }));
  }

  disconnect() {
    this.onclose?.(new Event("close") as CloseEvent);
  }

  close() {
    this.closed = true;
  }
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let latest: UseWindowClusterReturn;
let renderer: ReactTestRenderer | null;
let fetchHandler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function HookHarness() {
  const cluster = useWindowCluster();
  useEffect(() => {
    latest = cluster;
  }, [cluster]);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function until(assertion: () => void, attempts = 30) {
  let failure: unknown;
  for (let index = 0; index < attempts; index += 1) {
    await flush();
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function mount() {
  await act(async () => {
    renderer = create(<HookHarness />);
  });
  return ControlledWebSocket.instances[0]!;
}

async function mountReady() {
  const socket = await mount();
  socket.open();
  await until(() => expect(latest.loading).toBe(false));
  return socket;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  ControlledWebSocket.instances = [];
  renderer = null;
  latest = undefined as unknown as UseWindowClusterReturn;
  tauri.invoke.mockReset().mockResolvedValue(undefined);
  tauri.getByLabel.mockReset();
  fetchHandler = async (_input, init) => {
    if (init?.method === "PUT") {
      return response(JSON.parse(String(init.body)));
    }
    return response(INITIAL_LAYOUT);
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetchHandler(input, init)));
  vi.stubGlobal("WebSocket", ControlledWebSocket);
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
  }
  vi.unstubAllGlobals();
});

describe("useWindowCluster startup and event evidence", () => {
  it("subscribes first, buffers the latest valid event, and stays loading through native initialization", async () => {
    const staleGet = deferred<Response>();
    const initialize = deferred<unknown>();
    fetchHandler = async () => staleGet.promise;
    tauri.invoke.mockImplementation((command: string) =>
      command === "initialize_widget_windows" ? initialize.promise : Promise.resolve(),
    );

    const socket = await mount();

    expect(socket.url).toBe("ws://127.0.0.1:4242/api/events");
    expect(fetch).not.toHaveBeenCalled();
    expect(latest.loading).toBe(true);

    socket.open();
    await until(() => expect(fetch).toHaveBeenCalledTimes(1));

    const newest = { ...INITIAL_LAYOUT, rightVisible: true };
    socket.message({ type: "widget.layout.changed", payload: newest });
    staleGet.resolve(response(INITIAL_LAYOUT));

    await until(() =>
      expect(tauri.invoke).toHaveBeenCalledWith("initialize_widget_windows", { layout: newest }),
    );
    expect(latest.loading).toBe(true);

    const latestDuringInit = { ...newest, leftVisible: true };
    socket.message({ type: "widget.layout.changed", payload: latestDuringInit });
    initialize.resolve(undefined);
    await until(() => expect(latest.loading).toBe(false));
    expect(tauri.invoke).toHaveBeenCalledWith("apply_widget_layout", {
      layout: latestDuringInit,
    });
    expect(latest.layout).toEqual(latestDuringInit);
    expect(latest.error).toBeNull();
    expect(latest.degraded).toBeNull();
  });

  it("ignores malformed frames, applies valid external layouts once, and reports disconnect degradation", async () => {
    const socket = await mountReady();
    tauri.invoke.mockClear();

    socket.malformed("not-json");
    socket.message({ type: "widget.layout.changed", payload: { version: 7 } });
    await flush();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(latest.layout).toEqual(INITIAL_LAYOUT);

    const external = { ...INITIAL_LAYOUT, leftVisible: true };
    await act(async () => {
      socket.message({ type: "widget.layout.changed", payload: external });
    });
    await until(() =>
      expect(tauri.invoke).toHaveBeenCalledWith("apply_widget_layout", { layout: external }),
    );
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(latest.layout).toEqual(external);

    await act(async () => socket.disconnect());
    await until(() => expect(latest.degraded).toContain("event stream is disconnected"));
  });

  it("aborts the startup fetch and never initializes native windows after unmount", async () => {
    let signal: AbortSignal | undefined;
    const pending = deferred<Response>();
    fetchHandler = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    };

    const socket = await mount();
    socket.open();
    await until(() => expect(signal).toBeDefined());

    await act(async () => renderer?.unmount());
    renderer = null;
    expect(signal?.aborted).toBe(true);
    expect(socket.closed).toBe(true);

    pending.resolve(response(INITIAL_LAYOUT));
    await flush();
    expect(tauri.invoke).not.toHaveBeenCalledWith("initialize_widget_windows", expect.anything());
  });
});

describe("useWindowCluster ordered mutations", () => {
  it("persists toggles before native visibility and consumes the self echo without duplicate apply", async () => {
    const put = deferred<Response>();
    fetchHandler = async (_input, init) => {
      if (init?.method === "PUT") return put.promise;
      return response(INITIAL_LAYOUT);
    };
    const socket = await mount();
    socket.open();
    await until(() => expect(latest.loading).toBe(false));
    tauri.invoke.mockClear();

    const toggled = { ...INITIAL_LAYOUT, leftVisible: true };
    let action!: Promise<void>;
    await act(async () => {
      action = latest.toggleSide("left");
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:4242/api/settings/widgets",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(toggled) }),
    );
    expect(tauri.invoke).not.toHaveBeenCalled();

    socket.message({ type: "widget.layout.changed", payload: toggled });
    put.resolve(response(toggled));
    await act(async () => action);

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith("set_cluster_visibility", {
      side: "left",
      visible: true,
    });
    expect(latest.layout).toEqual(toggled);
  });

  it("does not mutate native state when persistence fails", async () => {
    fetchHandler = async (_input, init) =>
      init?.method === "PUT" ? response({ error: "no" }, 500) : response(INITIAL_LAYOUT);
    await mountReady();
    tauri.invoke.mockClear();

    await act(async () => latest.toggleSide("left"));

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(latest.layout).toEqual(INITIAL_LAYOUT);
    expect(latest.error).toContain("HTTP 500");
  });

  it("rolls persisted and native visibility back when the native toggle fails", async () => {
    const persistedBodies: ClusterLayoutV1[] = [];
    fetchHandler = async (_input, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as ClusterLayoutV1;
        persistedBodies.push(body);
        return response(body);
      }
      return response(INITIAL_LAYOUT);
    };
    await mountReady();
    tauri.invoke.mockClear();
    tauri.invoke.mockImplementation((command: string, args?: unknown) => {
      if (
        command === "set_cluster_visibility" &&
        (args as { visible?: boolean } | undefined)?.visible === true
      ) {
        return Promise.reject(new Error("native visibility failed"));
      }
      return Promise.resolve();
    });

    await act(async () => latest.toggleSide("left"));

    expect(persistedBodies).toEqual([
      { ...INITIAL_LAYOUT, leftVisible: true },
      INITIAL_LAYOUT,
    ]);
    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_visibility", { side: "left", visible: true }],
      ["set_cluster_visibility", { side: "left", visible: false }],
    ]);
    expect(latest.layout).toEqual(INITIAL_LAYOUT);
    expect(latest.error).toContain("native visibility failed");
  });

  it("serializes enter, commit, and cancel so each observes the preceding transition", async () => {
    const enter = deferred<unknown>();
    const commitPut = deferred<Response>();
    fetchHandler = async (_input, init) => {
      if (init?.method === "PUT") return commitPut.promise;
      return response(INITIAL_LAYOUT);
    };
    await mountReady();
    tauri.invoke.mockClear();
    tauri.invoke.mockImplementation((command: string) =>
      command === "set_cluster_edit_mode" ? enter.promise : Promise.resolve(),
    );

    let actions!: Promise<void>[];
    await act(async () => {
      actions = [latest.enterEdit(), latest.commitEdit(), latest.cancelEdit()];
      await Promise.resolve();
    });

    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_edit_mode", { enabled: true }],
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);

    enter.resolve(undefined);
    await until(() => expect(fetch).toHaveBeenCalledTimes(2));
    const committed = { ...INITIAL_LAYOUT, editMode: false };
    commitPut.resolve(response(committed));
    await act(async () => {
      await Promise.all(actions);
    });

    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_edit_mode", { enabled: true }],
      ["apply_widget_layout", { layout: committed }],
      ["apply_widget_layout", { layout: committed }],
    ]);
    expect(latest.layout).toEqual(committed);
  });

  it("persists a hidden placement before hiding its native window", async () => {
    const put = deferred<Response>();
    fetchHandler = async (_input, init) =>
      init?.method === "PUT" ? put.promise : response(INITIAL_LAYOUT);
    await mountReady();
    tauri.invoke.mockClear();

    let action!: Promise<void>;
    await act(async () => {
      action = latest.hideWidget("music");
      await Promise.resolve();
    });
    expect(tauri.invoke).not.toHaveBeenCalled();

    const hidden = {
      ...INITIAL_LAYOUT,
      placements: [{ ...INITIAL_LAYOUT.placements[0]!, visible: false }],
    };
    put.resolve(response(hidden));
    await act(async () => action);

    expect(tauri.invoke).toHaveBeenCalledWith("hide_widget_window", { widgetId: "music" });
    expect(latest.layout).toEqual(hidden);
  });
});
