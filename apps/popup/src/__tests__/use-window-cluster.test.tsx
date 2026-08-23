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
  getCurrentWindow: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  Window: { getByLabel: tauri.getByLabel },
  getCurrentWindow: tauri.getCurrentWindow,
}));
vi.mock("@tauri-apps/api/event", () => ({ emit: tauri.emit, listen: tauri.listen }));

import {
  useWindowCluster,
  type UseWindowClusterReturn,
} from "../hooks/useWindowCluster.js";
import { WidgetWindowShell } from "../widgets/WidgetWindowShell.js";

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

const CLUSTER_GEOMETRY = {
  main: { x: 600, y: 330, width: 720, height: 420 },
  output: { x: 0, y: 0, width: 1920, height: 1080 },
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

type TauriEventHandler = (event: { payload: unknown }) => void;

function installTauriEventBus() {
  const listeners = new Map<string, Set<TauriEventHandler>>();
  tauri.listen.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
    const handlers = listeners.get(eventName) ?? new Set<TauriEventHandler>();
    handlers.add(handler);
    listeners.set(eventName, handlers);
    return () => handlers.delete(handler);
  });
  tauri.emit.mockImplementation(async (eventName: string, payload: unknown) => {
    for (const handler of [...(listeners.get(eventName) ?? [])]) handler({ payload });
  });
  return {
    emit: async (eventName: string, payload: unknown) => {
      for (const handler of [...(listeners.get(eventName) ?? [])]) handler({ payload });
      await flush();
    },
    listenerCount: (eventName: string) => listeners.get(eventName)?.size ?? 0,
  };
}

let latest: UseWindowClusterReturn;
let renderer: ReactTestRenderer | null;
let extraRenderers: ReactTestRenderer[];
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
  extraRenderers = [];
  latest = undefined as unknown as UseWindowClusterReturn;
  tauri.invoke.mockReset().mockImplementation((command: string) =>
    command === "get_cluster_geometry" ? Promise.resolve(CLUSTER_GEOMETRY) : Promise.resolve(),
  );
  tauri.getByLabel.mockReset();
  tauri.getCurrentWindow.mockReset();
  tauri.emit.mockReset().mockResolvedValue(undefined);
  tauri.listen.mockReset().mockResolvedValue(() => undefined);
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
  if (renderer || extraRenderers.length > 0) {
    await act(async () => {
      renderer?.unmount();
      for (const extraRenderer of extraRenderers) extraRenderer.unmount();
    });
  }
  vi.useRealTimers();
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
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "set_cluster_edit_mode") return enter.promise;
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      return Promise.resolve();
    });

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
      ["get_cluster_geometry"],
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

  it("keeps candidate edits unpersisted and Cancel restores the committed geometry", async () => {
    await mountReady();
    tauri.invoke.mockClear();
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => latest.enterEdit());
    expect(latest.editSession).toEqual({
      committed: INITIAL_LAYOUT,
      candidate: { ...INITIAL_LAYOUT, editMode: true },
      dirty: false,
    });

    await act(async () => latest.updatePlacement("music", { size: "wide", lane: "bottom" }));
    expect(latest.editSession?.candidate.placements[0]).toMatchObject({ size: "wide", lane: "bottom" });
    expect(latest.editSession?.dirty).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => latest.cancelEdit());
    expect(fetch).not.toHaveBeenCalled();
    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_edit_mode", { enabled: true }],
      ["get_cluster_geometry"],
      ["apply_widget_layout", { layout: INITIAL_LAYOUT }],
    ]);
    expect(latest.editSession).toBeNull();
    expect(latest.layout).toEqual(INITIAL_LAYOUT);
  });

  it("Done performs exactly one canonical PUT and one native geometry apply", async () => {
    await mountReady();
    await act(async () => latest.enterEdit());
    tauri.invoke.mockClear();
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => latest.updatePlacement("music", { size: "compact" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();

    await act(async () => latest.commitEdit());
    const saved = {
      ...INITIAL_LAYOUT,
      placements: [{ ...INITIAL_LAYOUT.placements[0]!, size: "compact" as const }],
    };
    const puts = (fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[1]?.body).toBe(JSON.stringify(saved));
    expect(tauri.invoke.mock.calls).toEqual([
      ["apply_widget_layout", { layout: saved }],
    ]);
    expect(latest.editSession).toBeNull();
    expect(latest.layout).toEqual(saved);
  });

  it("computes settings-driven candidate overflow from bounded native geometry", async () => {
    const visibleLeft = { ...INITIAL_LAYOUT, leftVisible: true };
    fetchHandler = async (_input, init) =>
      init?.method === "PUT" ? response(JSON.parse(String(init.body))) : response(visibleLeft);
    tauri.invoke.mockImplementation((command: string) => command === "get_cluster_geometry"
      ? Promise.resolve({
        main: { x: 400, y: 40, width: 300, height: 420 },
        output: { x: 0, y: 0, width: 800, height: 600 },
      })
      : Promise.resolve());
    await mountReady();

    await act(async () => latest.enterEdit());
    await act(async () => latest.updatePlacement("system", {
      side: "left",
      order: 1,
      lane: "top",
      size: "standard",
      visible: true,
    }));

    expect(tauri.invoke).toHaveBeenCalledWith("get_cluster_geometry");
    expect(latest.overflowCount).toBe(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "PUT"))
      .toHaveLength(0);
  });

  it("accepts a nearest-slot drag without persistence and pushes an occupied placement", async () => {
    const dragLayout: ClusterLayoutV1 = {
      ...INITIAL_LAYOUT,
      leftVisible: true,
      rightVisible: true,
      placements: [
        INITIAL_LAYOUT.placements[0]!,
        { widgetId: "system", side: "left", order: 1, lane: "top", size: "compact", visible: true },
        { widgetId: "rvc", side: "right", order: 0, lane: "top", size: "standard", visible: true },
      ],
    };
    fetchHandler = async (_input, init) =>
      init?.method === "PUT" ? response(JSON.parse(String(init.body))) : response(dragLayout);
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "complete_widget_drag") {
        return Promise.resolve({
          dragged: { x: 345, y: 334, width: 250, height: 190 },
          main: { x: 600, y: 330, width: 720, height: 420 },
          output: { x: 0, y: 0, width: 1920, height: 1080 },
        });
      }
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    tauri.invoke.mockClear();
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => latest.completeDrag("rvc", 11));

    expect(latest.editSession?.candidate.placements.filter((placement) => placement.side === "left"))
      .toEqual([
        expect.objectContaining({ widgetId: "rvc", order: 0 }),
        expect.objectContaining({ widgetId: "music", order: 1 }),
        expect.objectContaining({ widgetId: "system", order: 2 }),
      ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(tauri.invoke.mock.calls[0]).toEqual([
      "complete_widget_drag",
      { widgetId: "rvc", dragToken: 11 },
    ]);
    expect(tauri.invoke.mock.calls[1]).toEqual([
      "apply_widget_layout",
      { layout: latest.editSession?.candidate },
    ]);
  });

  it("rejects an out-of-bounds drag and restores committed geometry", async () => {
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "complete_widget_drag") {
        return Promise.resolve({
          dragged: { x: -100, y: 330, width: 250, height: 190 },
          main: { x: 600, y: 330, width: 720, height: 420 },
          output: { x: 0, y: 0, width: 1920, height: 1080 },
        });
      }
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    await act(async () => latest.updatePlacement("music", { size: "wide" }));
    tauri.invoke.mockClear();
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => latest.completeDrag("music", 12));

    expect(fetch).not.toHaveBeenCalled();
    expect(tauri.invoke.mock.calls).toEqual([
      ["complete_widget_drag", { widgetId: "music", dragToken: 12 }],
      ["apply_widget_layout", { layout: { ...INITIAL_LAYOUT, editMode: true } }],
    ]);
    expect(latest.editSession?.candidate).toEqual({ ...INITIAL_LAYOUT, editMode: true });
  });

  it("restores committed edit geometry when applying a valid snapped candidate fails", async () => {
    const applied: ClusterLayoutV1[] = [];
    tauri.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "complete_widget_drag") {
        return Promise.resolve({
          dragged: { x: 1335, y: 334, width: 250, height: 190 },
          main: CLUSTER_GEOMETRY.main,
          output: CLUSTER_GEOMETRY.output,
        });
      }
      if (command === "apply_widget_layout") {
        const layout = (args as { layout: ClusterLayoutV1 }).layout;
        applied.push(layout);
        if (applied.length === 1) return Promise.reject(new Error("snap apply failed"));
      }
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    tauri.invoke.mockClear();

    await act(async () => latest.completeDrag("music", 13));

    expect(applied).toHaveLength(2);
    expect(applied[0]?.placements[0]).toMatchObject({ widgetId: "music", side: "right" });
    expect(applied[1]).toEqual({ ...INITIAL_LAYOUT, editMode: true });
    expect(latest.editSession?.candidate).toEqual({ ...INITIAL_LAYOUT, editMode: true });
    expect(latest.error).toContain("snap apply failed");
  });

  it("retains known geometry after a drag snapshot failure restores committed placement", async () => {
    const visibleLeft = { ...INITIAL_LAYOUT, leftVisible: true };
    fetchHandler = async (_input, init) =>
      init?.method === "PUT" ? response(JSON.parse(String(init.body))) : response(visibleLeft);
    const smallGeometry = {
      main: { x: 400, y: 40, width: 300, height: 420 },
      output: { x: 0, y: 0, width: 800, height: 600 },
    };
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "get_cluster_geometry") return Promise.resolve(smallGeometry);
      if (command === "complete_widget_drag") return Promise.reject(new Error("snapshot failed"));
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());

    await act(async () => latest.completeDrag("music", 14));
    await act(async () => latest.updatePlacement("system", {
      side: "left",
      order: 1,
      size: "standard",
      visible: true,
    }));

    expect(latest.overflowCount).toBe(1);
  });
});

describe("window cluster multi-root ownership", () => {
  it("waits for native move completion evidence before the beginDrag path can snapshot", async () => {
    const bus = installTauriEventBus();
    const calls: string[] = [];
    let movedHandler: (() => void) | undefined;
    const stopMoved = vi.fn();
    const dragging = deferred<void>();
    tauri.getCurrentWindow.mockReturnValue({
      onMoved: vi.fn(async (handler: () => void) => {
        calls.push("listen-moved");
        movedHandler = handler;
        return stopMoved;
      }),
      startDragging: vi.fn(async () => {
        calls.push("start-dragging");
        await dragging.promise;
      }),
    });
    tauri.invoke.mockImplementation((command: string) => {
      calls.push(command);
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "prepare_widget_drag") return Promise.resolve(41);
      if (command === "complete_widget_drag") {
        return Promise.resolve({
          dragged: { x: 345, y: 334, width: 250, height: 190 },
          main: CLUSTER_GEOMETRY.main,
          output: CLUSTER_GEOMETRY.output,
        });
      }
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    await act(async () => {
      extraRenderers.push(create(
        <WidgetWindowShell widgetId="music" title="Music"><div>music</div></WidgetWindowShell>,
      ));
    });
    await until(() => expect(
      extraRenderers[0]!.root.findAllByProps({ "aria-label": "Drag Music" }),
    ).toHaveLength(1));

    vi.useFakeTimers();
    const drag = extraRenderers[0]!.root.findByProps({ "aria-label": "Drag Music" });
    await act(async () => {
      drag.props.onPointerDown();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.indexOf("prepare_widget_drag")).toBeLessThan(calls.indexOf("listen-moved"));
    expect(calls.indexOf("listen-moved")).toBeLessThan(calls.indexOf("start-dragging"));
    expect(calls).not.toContain("complete_widget_drag");

    await act(async () => {
      movedHandler?.();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(calls).not.toContain("complete_widget_drag");

    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).not.toContain("complete_widget_drag");

    await act(async () => {
      dragging.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await until(() => expect(calls).toContain("complete_widget_drag"));
    expect(calls.indexOf("start-dragging")).toBeLessThan(calls.indexOf("complete_widget_drag"));
    expect(stopMoved).toHaveBeenCalledOnce();
    expect(bus.listenerCount("cluster-layout-action")).toBe(1);
  });

  it("times out a beginDrag with no move evidence, cancels its token, and rolls back", async () => {
    installTauriEventBus();
    const stopMoved = vi.fn();
    tauri.getCurrentWindow.mockReturnValue({
      onMoved: vi.fn(async () => stopMoved),
      startDragging: vi.fn().mockResolvedValue(undefined),
    });
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "prepare_widget_drag") return Promise.resolve(42);
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    await act(async () => latest.updatePlacement("music", { size: "wide" }));
    await act(async () => {
      extraRenderers.push(create(
        <WidgetWindowShell widgetId="music" title="Music"><div>music</div></WidgetWindowShell>,
      ));
    });
    await until(() => expect(
      extraRenderers[0]!.root.findAllByProps({ "aria-label": "Drag Music" }),
    ).toHaveLength(1));

    vi.useFakeTimers();
    const drag = extraRenderers[0]!.root.findByProps({ "aria-label": "Drag Music" });
    await act(async () => {
      drag.props.onPointerDown();
      await Promise.resolve();
      await Promise.resolve();
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });
    await until(() => expect(tauri.invoke).toHaveBeenCalledWith("cancel_widget_drag", {
      dragToken: 42,
    }));
    await until(() => expect(latest.editSession?.candidate).toEqual({
      ...INITIAL_LAYOUT,
      editMode: true,
    }));

    expect(tauri.invoke.mock.calls.some(([command]) => command === "complete_widget_drag")).toBe(false);
    expect(tauri.invoke).toHaveBeenCalledWith("apply_widget_layout", {
      layout: { ...INITIAL_LAYOUT, editMode: true },
    });
    expect(stopMoved).toHaveBeenCalledOnce();
  });

  it("cancels and rolls back an in-flight prepared drag when its widget root unmounts", async () => {
    installTauriEventBus();
    const stopMoved = vi.fn();
    tauri.getCurrentWindow.mockReturnValue({
      onMoved: vi.fn(async () => stopMoved),
      startDragging: vi.fn().mockResolvedValue(undefined),
    });
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "get_cluster_geometry") return Promise.resolve(CLUSTER_GEOMETRY);
      if (command === "prepare_widget_drag") return Promise.resolve(43);
      return Promise.resolve();
    });
    await mountReady();
    await act(async () => latest.enterEdit());
    await act(async () => latest.updatePlacement("music", { size: "wide" }));
    let shell!: ReactTestRenderer;
    await act(async () => {
      shell = create(
        <WidgetWindowShell widgetId="music" title="Music"><div>music</div></WidgetWindowShell>,
      );
      extraRenderers.push(shell);
    });
    await until(() => expect(shell.root.findAllByProps({ "aria-label": "Drag Music" })).toHaveLength(1));

    await act(async () => {
      shell.root.findByProps({ "aria-label": "Drag Music" }).props.onPointerDown();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => shell.unmount());
    extraRenderers = [];

    await until(() => expect(tauri.invoke).toHaveBeenCalledWith("cancel_widget_drag", {
      dragToken: 43,
    }));
    await until(() => expect(latest.editSession?.candidate).toEqual({
      ...INITIAL_LAYOUT,
      editMode: true,
    }));
    expect(stopMoved).toHaveBeenCalledOnce();
  });

  it("keeps one action bridge listener while rapid overflow and widget actions read current refs", async () => {
    const bus = installTauriEventBus();
    tauri.invoke.mockImplementation((command: string) => command === "get_cluster_geometry"
      ? Promise.resolve({
        main: { x: 400, y: 40, width: 300, height: 420 },
        output: { x: 0, y: 0, width: 800, height: 600 },
      })
      : Promise.resolve());
    await mountReady();
    expect(bus.listenerCount("cluster-layout-action")).toBe(1);

    await bus.emit("cluster-layout-action", { type: "enter" });
    await until(() => expect(latest.editSession).not.toBeNull());
    await bus.emit("cluster-layout-action", {
      type: "update-placement",
      widgetId: "system",
      changes: { side: "left", order: 1, size: "standard", visible: true },
    });
    await until(() => expect(latest.overflowCount).toBe(1));

    await bus.emit("cluster-layout-action", {
      type: "update-placement",
      widgetId: "music",
      changes: { size: "tall" },
    });
    await bus.emit("cluster-layout-action", { type: "cycle-size", widgetId: "music" });
    await bus.emit("cluster-layout-action", { type: "request-state" });
    await until(() => expect(
      latest.editSession?.candidate.placements.find((item) => item.widgetId === "music")?.size,
    ).toBe("wide"));

    expect(bus.listenerCount("cluster-layout-action")).toBe(1);
    expect(tauri.listen.mock.calls.filter(([eventName]) => eventName === "cluster-layout-action"))
      .toHaveLength(1);
    expect(tauri.emit).toHaveBeenCalledWith("cluster-layout-state", expect.objectContaining({
      overflowCount: 1,
    }));
  });

  it("keeps optional shells lightweight and applies their persisted hide once in the main controller", async () => {
    const socket = await mountReady();

    await act(async () => {
      extraRenderers.push(
        create(
          <WidgetWindowShell widgetId="music" title="Music">
            <div>music</div>
          </WidgetWindowShell>,
        ),
        create(
          <WidgetWindowShell widgetId="lyrics" title="Lyrics">
            <div>lyrics</div>
          </WidgetWindowShell>,
        ),
      );
    });

    expect(ControlledWebSocket.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "initialize_widget_windows"))
      .toHaveLength(1);
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "apply_widget_layout"))
      .toHaveLength(0);

    const hidden = {
      ...INITIAL_LAYOUT,
      placements: [{ ...INITIAL_LAYOUT.placements[0]!, visible: false }],
    };
    fetchHandler = async (_input, init) => {
      if (init?.method === "PUT") {
        socket.message({ type: "widget.layout.changed", payload: hidden });
        return response(hidden);
      }
      return response(INITIAL_LAYOUT);
    };

    const close = extraRenderers[0]!.root.findByProps({ "aria-label": "Hide Music" });
    await act(async () => close.props.onClick());
    await until(() => expect(latest.layout).toEqual(hidden));

    expect(ControlledWebSocket.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "PUT"))
      .toHaveLength(1);
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "initialize_widget_windows"))
      .toHaveLength(1);
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "apply_widget_layout"))
      .toEqual([["apply_widget_layout", { layout: hidden }]]);
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "hide_widget_window"))
      .toHaveLength(0);
  });
});

describe("window cluster action cleanup", () => {
  it("cancels queued toggle, hide, commit, cancel, and settings actions when unmounted", async () => {
    const entering = deferred<unknown>();
    await mountReady();
    tauri.invoke.mockClear();
    (fetch as ReturnType<typeof vi.fn>).mockClear();
    tauri.invoke.mockImplementation((command: string) =>
      command === "set_cluster_edit_mode" ? entering.promise : Promise.resolve(),
    );

    let actions!: Promise<void>[];
    await act(async () => {
      actions = [
        latest.enterEdit(),
        latest.toggleSide("left"),
        latest.hideWidget("music"),
        latest.commitEdit(),
        latest.cancelEdit(),
        latest.openSettings(),
      ];
      await Promise.resolve();
    });
    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_edit_mode", { enabled: true }],
    ]);

    await act(async () => renderer?.unmount());
    renderer = null;
    entering.resolve(undefined);
    await act(async () => {
      await Promise.all(actions);
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(tauri.invoke.mock.calls).toEqual([
      ["set_cluster_edit_mode", { enabled: true }],
    ]);
    expect(tauri.getByLabel).not.toHaveBeenCalled();
    expect(latest.layout).toEqual(INITIAL_LAYOUT);
  });

  it("aborts in-flight persistence and performs no native or state effect after unmount", async () => {
    const put = deferred<Response>();
    let putSignal: AbortSignal | undefined;
    fetchHandler = async (_input, init) => {
      if (init?.method === "PUT") {
        putSignal = init.signal ?? undefined;
        return put.promise;
      }
      return response(INITIAL_LAYOUT);
    };
    await mountReady();
    tauri.invoke.mockClear();

    let action!: Promise<void>;
    await act(async () => {
      action = latest.toggleSide("left");
      await Promise.resolve();
    });
    await until(() => expect(putSignal).toBeDefined());

    await act(async () => renderer?.unmount());
    renderer = null;
    expect(putSignal?.aborted).toBe(true);
    put.resolve(response({ ...INITIAL_LAYOUT, leftVisible: true }));
    await act(async () => action);

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(latest.layout).toEqual(INITIAL_LAYOUT);
  });

  it("does not show or focus settings when lookup finishes after unmount", async () => {
    const lookup = deferred<{ show: ReturnType<typeof vi.fn>; setFocus: ReturnType<typeof vi.fn> }>();
    const settings = {
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    tauri.getByLabel.mockReturnValue(lookup.promise);
    await mountReady();

    const action = latest.openSettings();
    await until(() => expect(tauri.getByLabel).toHaveBeenCalledWith("settings"));
    await act(async () => renderer?.unmount());
    renderer = null;
    lookup.resolve(settings);
    await act(async () => action);

    expect(settings.show).not.toHaveBeenCalled();
    expect(settings.setFocus).not.toHaveBeenCalled();
  });

  it("does not focus settings when show finishes after unmount", async () => {
    const shown = deferred<void>();
    const settings = {
      show: vi.fn(() => shown.promise),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    tauri.getByLabel.mockResolvedValue(settings);
    await mountReady();

    const action = latest.openSettings();
    await until(() => expect(settings.show).toHaveBeenCalledOnce());
    await act(async () => renderer?.unmount());
    renderer = null;
    shown.resolve();
    await act(async () => action);

    expect(settings.setFocus).not.toHaveBeenCalled();
  });

  it("aborts an in-flight optional hide and drops its queued hide before either can save", async () => {
    const get = deferred<Response>();
    let getSignal: AbortSignal | undefined;
    fetchHandler = async (_input, init) => {
      if (!init?.method) {
        getSignal = init?.signal ?? undefined;
        return get.promise;
      }
      return response(JSON.parse(String(init.body)));
    };

    let shell!: ReactTestRenderer;
    await act(async () => {
      shell = create(
        <WidgetWindowShell widgetId="music" title="Music">
          <div>music</div>
        </WidgetWindowShell>,
      );
      extraRenderers.push(shell);
    });
    const close = shell.root.findByProps({ "aria-label": "Hide Music" });
    await act(async () => {
      close.props.onClick();
      close.props.onClick();
      await Promise.resolve();
    });
    await until(() => expect(getSignal).toBeDefined());

    await act(async () => shell.unmount());
    extraRenderers = [];
    expect(getSignal?.aborted).toBe(true);
    get.resolve(response(INITIAL_LAYOUT));
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "PUT"))
      .toHaveLength(0);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
