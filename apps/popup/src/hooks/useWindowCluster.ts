import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClusterLayoutV1Schema,
  DaemonEventSchema,
  type ClusterLayoutV1,
  type WidgetSide,
  type WidgetWindowId,
} from "@presenced/contracts";
import { invoke } from "@tauri-apps/api/core";
import { Window } from "@tauri-apps/api/window";

const LAYOUT_URL = "http://127.0.0.1:4242/api/settings/widgets";
const LAYOUT_EVENTS_URL = "ws://127.0.0.1:4242/api/events";
const LAYOUT_STREAM_LIMITATION =
  "Layout synchronization is paused because the daemon event stream is disconnected; no polling fallback is used.";

export interface UseWindowClusterReturn {
  layout: ClusterLayoutV1 | null;
  loading: boolean;
  error: string | null;
  degraded: string | null;
  toggleSide: (side: WidgetSide) => Promise<void>;
  openSettings: () => Promise<void>;
  enterEdit: () => Promise<void>;
  commitEdit: () => Promise<void>;
  cancelEdit: () => Promise<void>;
  hideWidget: (widgetId: WidgetWindowId) => Promise<void>;
}

export function setSideVisible(
  layout: ClusterLayoutV1,
  side: WidgetSide,
  visible: boolean,
): ClusterLayoutV1 {
  return side === "left"
    ? { ...layout, leftVisible: visible }
    : { ...layout, rightVisible: visible };
}

export function hidePlacement(
  layout: ClusterLayoutV1,
  widgetId: WidgetWindowId,
): ClusterLayoutV1 {
  return {
    ...layout,
    placements: layout.placements.map((placement) =>
      placement.widgetId === widgetId ? { ...placement, visible: false } : placement,
    ),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function layoutKey(layout: ClusterLayoutV1): string {
  return JSON.stringify(layout);
}

async function loadLayout(signal?: AbortSignal): Promise<ClusterLayoutV1> {
  const response = await fetch(LAYOUT_URL, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`Failed to load widget layout (HTTP ${response.status})`);
  }
  const parsed = ClusterLayoutV1Schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Daemon returned an invalid widget layout");
  }
  return parsed.data;
}

async function saveLayout(layout: ClusterLayoutV1): Promise<ClusterLayoutV1> {
  const response = await fetch(LAYOUT_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
  });
  if (!response.ok) {
    throw new Error(`Failed to save widget layout (HTTP ${response.status})`);
  }
  const parsed = ClusterLayoutV1Schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Daemon returned an invalid saved widget layout");
  }
  return parsed.data;
}

function incrementExpectedEcho(echoes: Map<string, number>, layout: ClusterLayoutV1) {
  const key = layoutKey(layout);
  echoes.set(key, (echoes.get(key) ?? 0) + 1);
}

function consumeExpectedEcho(echoes: Map<string, number>, layout: ClusterLayoutV1): boolean {
  const key = layoutKey(layout);
  const count = echoes.get(key) ?? 0;
  if (count === 0) return false;
  if (count === 1) echoes.delete(key);
  else echoes.set(key, count - 1);
  return true;
}

export function useWindowCluster(): UseWindowClusterReturn {
  const [layout, setLayout] = useState<ClusterLayoutV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const layoutRef = useRef<ClusterLayoutV1 | null>(null);
  const committedLayoutRef = useRef<ClusterLayoutV1 | null>(null);
  const nativeLayoutRef = useRef<ClusterLayoutV1 | null>(null);
  const mountedRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const expectedEchoesRef = useRef(new Map<string, number>());

  const acceptCommittedLayout = useCallback((next: ClusterLayoutV1) => {
    if (!mountedRef.current) return;
    layoutRef.current = next;
    committedLayoutRef.current = next;
    setLayout(next);
  }, []);

  const acceptWorkingLayout = useCallback((next: ClusterLayoutV1) => {
    if (!mountedRef.current) return;
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const enqueueOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
    const result = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const saveWithEcho = useCallback(async (next: ClusterLayoutV1) => {
    incrementExpectedEcho(expectedEchoesRef.current, next);
    try {
      return await saveLayout(next);
    } catch (saveError) {
      consumeExpectedEcho(expectedEchoesRef.current, next);
      throw saveError;
    }
  }, []);

  const applyDaemonLayout = useCallback(async (next: ClusterLayoutV1) => {
    if (!mountedRef.current) return;
    if (nativeLayoutRef.current && layoutKey(nativeLayoutRef.current) === layoutKey(next)) {
      acceptCommittedLayout(next);
      return;
    }
    await invoke("apply_widget_layout", { layout: next });
    if (!mountedRef.current) return;
    nativeLayoutRef.current = next;
    acceptCommittedLayout(next);
    setError(null);
  }, [acceptCommittedLayout]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let startupReady = false;
    let socketConnected = false;
    let latestStartupLayout: ClusterLayoutV1 | null = null;
    let startupEventVersion = 0;
    let socket: WebSocket | null = null;
    const abortController = new AbortController();

    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const socketOpen = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });

    const reportDisconnected = () => {
      if (!active) return;
      socketConnected = false;
      setDegraded(LAYOUT_STREAM_LIMITATION);
    };

    const ensureStartupActive = () => {
      if (!active) throw new DOMException("Window cluster startup was aborted", "AbortError");
      if (!socketConnected) throw new Error("Daemon layout event stream disconnected during initialization");
    };

    socket = new WebSocket(LAYOUT_EVENTS_URL);
    socket.onopen = () => {
      if (!active) return;
      socketConnected = true;
      resolveOpen();
    };
    socket.onmessage = (event) => {
      if (!active || typeof event.data !== "string") return;
      try {
        const daemonEvent = DaemonEventSchema.safeParse(JSON.parse(event.data));
        if (!daemonEvent.success || daemonEvent.data.type !== "widget.layout.changed") return;
        const next = daemonEvent.data.payload;
        if (consumeExpectedEcho(expectedEchoesRef.current, next)) return;
        if (!startupReady) {
          latestStartupLayout = next;
          startupEventVersion += 1;
          return;
        }
        void enqueueOperation(async () => {
          try {
            await applyDaemonLayout(next);
          } catch (applyError) {
            if (mountedRef.current) {
              setError(errorMessage(applyError, "Failed to apply daemon widget layout"));
            }
          }
        });
      } catch {
        // Only validated daemon evidence is allowed to change cluster state.
      }
    };
    socket.onerror = () => {
      if (!socketConnected) rejectOpen(new Error("Failed to open daemon layout event stream"));
      reportDisconnected();
    };
    socket.onclose = () => {
      if (!socketConnected) rejectOpen(new Error("Daemon layout event stream closed before opening"));
      reportDisconnected();
    };

    const start = async () => {
      try {
        await socketOpen;
        ensureStartupActive();
        const fetchedLayout = await loadLayout(abortController.signal);
        ensureStartupActive();

        let target = latestStartupLayout ?? fetchedLayout;
        let appliedEventVersion = startupEventVersion;
        await invoke("initialize_widget_windows", { layout: target });
        ensureStartupActive();
        nativeLayoutRef.current = target;

        while (startupEventVersion > appliedEventVersion) {
          target = latestStartupLayout ?? target;
          appliedEventVersion = startupEventVersion;
          await invoke("apply_widget_layout", { layout: target });
          ensureStartupActive();
          nativeLayoutRef.current = target;
        }

        startupReady = true;
        acceptCommittedLayout(target);
        setError(null);
        setDegraded(null);
      } catch (startError) {
        if (active) {
          setError(errorMessage(startError, "Failed to initialize the window cluster"));
          setDegraded("Window cluster initialization did not complete.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void start();
    return () => {
      active = false;
      mountedRef.current = false;
      abortController.abort();
      socket?.close();
      expectedEchoesRef.current.clear();
    };
  }, [acceptCommittedLayout, applyDaemonLayout, enqueueOperation]);

  const runAction = useCallback((action: () => Promise<void>, fallback: string) =>
    enqueueOperation(async () => {
      try {
        await action();
        if (mountedRef.current) setError(null);
      } catch (actionError) {
        if (mountedRef.current) setError(errorMessage(actionError, fallback));
      }
    }), [enqueueOperation]);

  const persistThenApply = useCallback(async (
    previous: ClusterLayoutV1,
    candidate: ClusterLayoutV1,
    applyNative: (saved: ClusterLayoutV1) => Promise<void>,
    rollbackNative: (restored: ClusterLayoutV1) => Promise<void>,
  ) => {
    const saved = await saveWithEcho(candidate);
    if (!mountedRef.current) return;
    try {
      await applyNative(saved);
    } catch (nativeError) {
      try {
        const restored = await saveWithEcho(previous);
        if (!mountedRef.current) return;
        await rollbackNative(restored);
        if (!mountedRef.current) return;
        nativeLayoutRef.current = restored;
        acceptCommittedLayout(restored);
      } catch (rollbackError) {
        throw new Error(
          `${errorMessage(nativeError, "Native layout update failed")}; rollback failed: ${errorMessage(rollbackError, "unknown rollback failure")}`,
        );
      }
      throw nativeError;
    }
    if (!mountedRef.current) return;
    nativeLayoutRef.current = saved;
    acceptCommittedLayout(saved);
  }, [acceptCommittedLayout, saveWithEcho]);

  const toggleSide = useCallback(async (side: WidgetSide) => {
    await runAction(async () => {
      const current = layoutRef.current;
      const committed = committedLayoutRef.current;
      if (!current || !committed) throw new Error("Window cluster layout is not loaded");
      const currentlyVisible = side === "left" ? current.leftVisible : current.rightVisible;
      const visible = !currentlyVisible;
      const next = setSideVisible(current, side, visible);
      await persistThenApply(
        committed,
        next,
        async () => invoke("set_cluster_visibility", { side, visible }),
        async (restored) => invoke("set_cluster_visibility", {
          side,
          visible: side === "left" ? restored.leftVisible : restored.rightVisible,
        }),
      );
    }, `Failed to toggle ${side} cluster windows`);
  }, [persistThenApply, runAction]);

  const openSettings = useCallback(async () => {
    await runAction(async () => {
      const settings = await Window.getByLabel("settings");
      if (!settings) throw new Error("Settings window is unavailable");
      await settings.show();
      await settings.setFocus();
    }, "Failed to open settings window");
  }, [runAction]);

  const enterEdit = useCallback(async () => {
    await runAction(async () => {
      const current = layoutRef.current;
      if (!current) throw new Error("Window cluster layout is not loaded");
      await invoke("set_cluster_edit_mode", { enabled: true });
      if (!mountedRef.current) return;
      const next = { ...current, editMode: true };
      nativeLayoutRef.current = next;
      acceptWorkingLayout(next);
    }, "Failed to enter cluster edit mode");
  }, [acceptWorkingLayout, runAction]);

  const commitEdit = useCallback(async () => {
    await runAction(async () => {
      const current = layoutRef.current;
      const committed = committedLayoutRef.current;
      if (!current || !committed) throw new Error("Window cluster layout is not loaded");
      const next = { ...current, editMode: false };
      await persistThenApply(
        committed,
        next,
        async (saved) => invoke("apply_widget_layout", { layout: saved }),
        async (restored) => invoke("apply_widget_layout", { layout: restored }),
      );
    }, "Failed to commit cluster layout");
  }, [persistThenApply, runAction]);

  const cancelEdit = useCallback(async () => {
    await runAction(async () => {
      const committed = committedLayoutRef.current;
      if (!committed) throw new Error("No committed window cluster layout is available");
      const restored = { ...committed, editMode: false };
      await invoke("apply_widget_layout", { layout: restored });
      if (!mountedRef.current) return;
      nativeLayoutRef.current = restored;
      acceptWorkingLayout(restored);
    }, "Failed to cancel cluster layout editing");
  }, [acceptWorkingLayout, runAction]);

  const hideWidget = useCallback(async (widgetId: WidgetWindowId) => {
    await runAction(async () => {
      const current = layoutRef.current;
      const committed = committedLayoutRef.current;
      if (!current || !committed) throw new Error("Window cluster layout is not loaded");
      const next = hidePlacement(current, widgetId);
      await persistThenApply(
        committed,
        next,
        async () => invoke("hide_widget_window", { widgetId }),
        async (restored) => invoke("apply_widget_layout", { layout: restored }),
      );
    }, `Failed to hide ${widgetId} widget`);
  }, [persistThenApply, runAction]);

  return {
    layout,
    loading,
    error,
    degraded,
    toggleSide,
    openSettings,
    enterEdit,
    commitEdit,
    cancelEdit,
    hideWidget,
  };
}
