import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClusterLayoutV1Schema,
  DaemonEventSchema,
  type ClusterLayoutV1,
  type WidgetPlacement,
  type WidgetSide,
  type WidgetWindowId,
} from "@presenced/contracts";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import {
  createTutorialLayout,
  OPTIONAL_WIDGET_IDS,
  projectClusterLayout,
  resetCandidateLayout,
  snapDraggedPlacement,
  updateCandidatePlacement,
  type DragSnapshot,
} from "../lib/window-cluster-layout.js";

const LAYOUT_URL = "http://127.0.0.1:4242/api/settings/widgets";
const LAYOUT_EVENTS_URL = "ws://127.0.0.1:4242/api/events";
const LAYOUT_STREAM_LIMITATION =
  "Layout synchronization is paused because the daemon event stream is disconnected; no polling fallback is used.";
const LAYOUT_ACTION_EVENT = "cluster-layout-action";
const LAYOUT_STATE_EVENT = "cluster-layout-state";

export interface EditSession {
  committed: ClusterLayoutV1;
  candidate: ClusterLayoutV1;
  dirty: boolean;
}

export interface UseWindowClusterReturn {
  layout: ClusterLayoutV1 | null;
  editSession: EditSession | null;
  overflowCount: number;
  loading: boolean;
  error: string | null;
  degraded: string | null;
  toggleSide: (side: WidgetSide) => Promise<void>;
  openSettings: () => Promise<void>;
  enterEdit: () => Promise<void>;
  commitEdit: () => Promise<void>;
  cancelEdit: () => Promise<void>;
  hideWidget: (widgetId: WidgetWindowId) => Promise<void>;
  updatePlacement: (
    widgetId: WidgetWindowId,
    changes: Partial<Omit<WidgetPlacement, "widgetId">>,
  ) => Promise<void>;
  resetEdit: () => Promise<void>;
  completeDrag: (widgetId: WidgetWindowId) => Promise<void>;
  applyTutorialSelection: (widgetIds: WidgetWindowId[]) => Promise<void>;
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

function candidateKey(layout: ClusterLayoutV1): string {
  return layoutKey({ ...layout, editMode: false });
}

function isRect(value: unknown): value is DragSnapshot["dragged"] {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return [rect.x, rect.y, rect.width, rect.height].every((part) => (
    typeof part === "number" && Number.isFinite(part)
  )) && (rect.width as number) > 0 && (rect.height as number) > 0;
}

function parseDragSnapshot(value: unknown): DragSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  return isRect(snapshot.dragged) && isRect(snapshot.main) && isRect(snapshot.output)
    ? { dragged: snapshot.dragged, main: snapshot.main, output: snapshot.output }
    : null;
}

function parseClusterGeometry(
  value: unknown,
): Pick<DragSnapshot, "main" | "output"> | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as Record<string, unknown>;
  return isRect(geometry.main) && isRect(geometry.output)
    ? { main: geometry.main, output: geometry.output }
    : null;
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

async function saveLayout(layout: ClusterLayoutV1, signal?: AbortSignal): Promise<ClusterLayoutV1> {
  const response = await fetch(LAYOUT_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
    ...(signal ? { signal } : {}),
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

function actionIsActive(mounted: { current: boolean }, signal: AbortSignal): boolean {
  return mounted.current && !signal.aborted;
}

function requireActiveAction(mounted: { current: boolean }, signal: AbortSignal): void {
  if (!actionIsActive(mounted, signal)) {
    throw new DOMException("Window cluster action was aborted", "AbortError");
  }
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
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [overflowCount, setOverflowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const layoutRef = useRef<ClusterLayoutV1 | null>(null);
  const committedLayoutRef = useRef<ClusterLayoutV1 | null>(null);
  const nativeLayoutRef = useRef<ClusterLayoutV1 | null>(null);
  const editSessionRef = useRef<EditSession | null>(null);
  const geometryRef = useRef<Pick<DragSnapshot, "main" | "output"> | null>(null);
  const mountedRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const expectedEchoesRef = useRef(new Map<string, number>());
  const actionControllersRef = useRef(new Set<AbortController>());

  const acceptCommittedLayout = useCallback((next: ClusterLayoutV1) => {
    if (!mountedRef.current) return;
    editSessionRef.current = null;
    layoutRef.current = next;
    committedLayoutRef.current = next;
    setEditSession(null);
    setOverflowCount(0);
    setLayout(next);
  }, []);

  const acceptCandidateLayout = useCallback((next: ClusterLayoutV1) => {
    if (!mountedRef.current) return;
    const session = editSessionRef.current;
    if (!session) throw new Error("Window cluster is not in edit mode");
    const parsed = ClusterLayoutV1Schema.safeParse({ ...next, editMode: true });
    if (!parsed.success) throw new Error("Candidate widget layout is invalid");
    const updated: EditSession = {
      committed: session.committed,
      candidate: parsed.data,
      dirty: candidateKey(parsed.data) !== candidateKey(session.committed),
    };
    editSessionRef.current = updated;
    layoutRef.current = parsed.data;
    setEditSession(updated);
    setLayout(parsed.data);
    const geometry = geometryRef.current;
    setOverflowCount(geometry
      ? projectClusterLayout(parsed.data, geometry.main, geometry.output).overflowWidgetIds.length
      : 0);
  }, []);

  const enqueueOperation = useCallback((operation: () => Promise<void>): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve();
    const runIfMounted = async () => {
      if (!mountedRef.current) return;
      await operation();
    };
    const result = operationQueueRef.current.then(runIfMounted, runIfMounted);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const saveWithEcho = useCallback(async (next: ClusterLayoutV1, signal: AbortSignal) => {
    requireActiveAction(mountedRef, signal);
    incrementExpectedEcho(expectedEchoesRef.current, next);
    try {
      const saved = await saveLayout(next, signal);
      requireActiveAction(mountedRef, signal);
      return saved;
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
      for (const controller of actionControllersRef.current) controller.abort();
      actionControllersRef.current.clear();
      socket?.close();
      expectedEchoesRef.current.clear();
    };
  }, [acceptCommittedLayout, applyDaemonLayout, enqueueOperation]);

  const runAction = useCallback((
    action: (signal: AbortSignal) => Promise<void>,
    fallback: string,
  ): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve();
    return enqueueOperation(async () => {
      if (!mountedRef.current) return;
      const controller = new AbortController();
      actionControllersRef.current.add(controller);
      try {
        requireActiveAction(mountedRef, controller.signal);
        await action(controller.signal);
        if (actionIsActive(mountedRef, controller.signal)) setError(null);
      } catch (actionError) {
        if (actionIsActive(mountedRef, controller.signal)) {
          setError(errorMessage(actionError, fallback));
        }
      } finally {
        actionControllersRef.current.delete(controller);
      }
    });
  }, [enqueueOperation]);

  const persistThenApply = useCallback(async (
    previous: ClusterLayoutV1,
    candidate: ClusterLayoutV1,
    applyNative: (saved: ClusterLayoutV1) => Promise<void>,
    rollbackNative: (restored: ClusterLayoutV1) => Promise<void>,
    signal: AbortSignal,
  ) => {
    requireActiveAction(mountedRef, signal);
    const saved = await saveWithEcho(candidate, signal);
    if (!actionIsActive(mountedRef, signal)) return;
    try {
      await applyNative(saved);
    } catch (nativeError) {
      if (!actionIsActive(mountedRef, signal)) return;
      try {
        const restored = await saveWithEcho(previous, signal);
        if (!actionIsActive(mountedRef, signal)) return;
        await rollbackNative(restored);
        if (!actionIsActive(mountedRef, signal)) return;
        nativeLayoutRef.current = restored;
        acceptCommittedLayout(restored);
      } catch (rollbackError) {
        throw new Error(
          `${errorMessage(nativeError, "Native layout update failed")}; rollback failed: ${errorMessage(rollbackError, "unknown rollback failure")}`,
        );
      }
      throw nativeError;
    }
    if (!actionIsActive(mountedRef, signal)) return;
    nativeLayoutRef.current = saved;
    acceptCommittedLayout(saved);
  }, [acceptCommittedLayout, saveWithEcho]);

  const toggleSide = useCallback(async (side: WidgetSide) => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const current = layoutRef.current;
      const committed = committedLayoutRef.current;
      if (!current || !committed) throw new Error("Window cluster layout is not loaded");
      const currentlyVisible = side === "left" ? current.leftVisible : current.rightVisible;
      const visible = !currentlyVisible;
      const next = setSideVisible(current, side, visible);
      if (editSessionRef.current) {
        acceptCandidateLayout(next);
        return;
      }
      await persistThenApply(
        committed,
        next,
        async () => invoke("set_cluster_visibility", { side, visible }),
        async (restored) => invoke("set_cluster_visibility", {
          side,
          visible: side === "left" ? restored.leftVisible : restored.rightVisible,
        }),
        signal,
      );
    }, `Failed to toggle ${side} cluster windows`);
  }, [persistThenApply, runAction]);

  const openSettings = useCallback(async () => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const settings = await Window.getByLabel("settings");
      if (!actionIsActive(mountedRef, signal)) return;
      if (!settings) throw new Error("Settings window is unavailable");
      await settings.show();
      if (!actionIsActive(mountedRef, signal)) return;
      await settings.setFocus();
    }, "Failed to open settings window");
  }, [runAction]);

  const enterEdit = useCallback(async () => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const committed = committedLayoutRef.current;
      if (!committed) throw new Error("Window cluster layout is not loaded");
      if (editSessionRef.current) return;
      await invoke("set_cluster_edit_mode", { enabled: true });
      if (!actionIsActive(mountedRef, signal)) return;
      let geometry: Pick<DragSnapshot, "main" | "output"> | null = null;
      try {
        geometry = parseClusterGeometry(await invoke("get_cluster_geometry"));
        if (!geometry) throw new Error("Native cluster geometry is invalid");
      } catch (geometryError) {
        if (actionIsActive(mountedRef, signal)) {
          await invoke("set_cluster_edit_mode", { enabled: false });
        }
        throw geometryError;
      }
      requireActiveAction(mountedRef, signal);
      const candidate = { ...committed, editMode: true };
      const session: EditSession = { committed, candidate, dirty: false };
      editSessionRef.current = session;
      nativeLayoutRef.current = candidate;
      geometryRef.current = geometry;
      layoutRef.current = candidate;
      setEditSession(session);
      setOverflowCount(projectClusterLayout(candidate, geometry.main, geometry.output).overflowWidgetIds.length);
      setLayout(candidate);
    }, "Failed to enter cluster edit mode");
  }, [runAction]);

  const commitEdit = useCallback(async () => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const session = editSessionRef.current;
      if (!session) throw new Error("Window cluster is not in edit mode");
      const next = { ...session.candidate, editMode: false };
      await persistThenApply(
        session.committed,
        next,
        async (saved) => invoke("apply_widget_layout", { layout: saved }),
        async (restored) => invoke("apply_widget_layout", { layout: restored }),
        signal,
      );
    }, "Failed to commit cluster layout");
  }, [persistThenApply, runAction]);

  const cancelEdit = useCallback(async () => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const session = editSessionRef.current;
      if (!session) throw new Error("No committed window cluster layout is available");
      await invoke("apply_widget_layout", { layout: session.committed });
      if (!actionIsActive(mountedRef, signal)) return;
      nativeLayoutRef.current = session.committed;
      acceptCommittedLayout(session.committed);
    }, "Failed to cancel cluster layout editing");
  }, [acceptCommittedLayout, runAction]);

  const hideWidget = useCallback(async (widgetId: WidgetWindowId) => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const current = layoutRef.current;
      const committed = committedLayoutRef.current;
      if (!current || !committed) throw new Error("Window cluster layout is not loaded");
      const next = hidePlacement(current, widgetId);
      if (editSessionRef.current) {
        acceptCandidateLayout(next);
        return;
      }
      await persistThenApply(
        committed,
        next,
        async () => invoke("hide_widget_window", { widgetId }),
        async (restored) => invoke("apply_widget_layout", { layout: restored }),
        signal,
      );
    }, `Failed to hide ${widgetId} widget`);
  }, [persistThenApply, runAction]);

  const updatePlacement = useCallback(async (
    widgetId: WidgetWindowId,
    changes: Partial<Omit<WidgetPlacement, "widgetId">>,
  ) => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const session = editSessionRef.current;
      if (!session) throw new Error("Window cluster is not in edit mode");
      acceptCandidateLayout(updateCandidatePlacement(session.candidate, widgetId, changes));
    }, `Failed to edit ${widgetId} placement`);
  }, [acceptCandidateLayout, runAction]);

  const resetEdit = useCallback(async () => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      if (!editSessionRef.current) throw new Error("Window cluster is not in edit mode");
      acceptCandidateLayout(resetCandidateLayout());
    }, "Failed to reset candidate widget layout");
  }, [acceptCandidateLayout, runAction]);

  const completeDrag = useCallback(async (widgetId: WidgetWindowId) => {
    await runAction(async (signal) => {
      requireActiveAction(mountedRef, signal);
      const session = editSessionRef.current;
      if (!session) throw new Error("Window cluster is not in edit mode");

      let rawSnapshot: unknown;
      try {
        rawSnapshot = await invoke("complete_widget_drag", { widgetId });
      } catch (captureError) {
        if (actionIsActive(mountedRef, signal)) {
          const restored = { ...session.committed, editMode: true };
          await invoke("apply_widget_layout", { layout: restored });
          requireActiveAction(mountedRef, signal);
          nativeLayoutRef.current = restored;
          acceptCandidateLayout(restored);
        }
        throw captureError;
      }
      requireActiveAction(mountedRef, signal);
      const snapshot = parseDragSnapshot(rawSnapshot);
      const snapped = snapshot
        ? snapDraggedPlacement(session.candidate, widgetId, snapshot)
        : null;
      if (!snapshot || !snapped) {
        const restored = { ...session.committed, editMode: true };
        await invoke("apply_widget_layout", { layout: restored });
        requireActiveAction(mountedRef, signal);
        nativeLayoutRef.current = restored;
        if (snapshot) geometryRef.current = { main: snapshot.main, output: snapshot.output };
        acceptCandidateLayout(restored);
        return;
      }
      try {
        await invoke("apply_widget_layout", { layout: snapped });
      } catch (snapError) {
        const restored = { ...session.committed, editMode: true };
        if (actionIsActive(mountedRef, signal)) {
          await invoke("apply_widget_layout", { layout: restored });
          requireActiveAction(mountedRef, signal);
          nativeLayoutRef.current = restored;
          geometryRef.current = { main: snapshot.main, output: snapshot.output };
          acceptCandidateLayout(restored);
        }
        throw snapError;
      }
      requireActiveAction(mountedRef, signal);
      nativeLayoutRef.current = snapped;
      geometryRef.current = { main: snapshot.main, output: snapshot.output };
      acceptCandidateLayout(snapped);
    }, `Failed to complete ${widgetId} drag`);
  }, [acceptCandidateLayout, runAction]);

  const applyTutorialSelection = useCallback((widgetIds: WidgetWindowId[]): Promise<void> => {
    if (!mountedRef.current) {
      return Promise.reject(new Error("Window cluster layout is not loaded"));
    }
    return enqueueOperation(async () => {
      if (!mountedRef.current) throw new Error("Window cluster action was aborted");
      const controller = new AbortController();
      actionControllersRef.current.add(controller);
      try {
        requireActiveAction(mountedRef, controller.signal);
        const committed = committedLayoutRef.current;
        if (!committed) throw new Error("Window cluster layout is not loaded");
        const next = createTutorialLayout(widgetIds);
        await persistThenApply(
          committed,
          next,
          async (saved) => invoke("apply_widget_layout", { layout: saved }),
          async (restored) => invoke("apply_widget_layout", { layout: restored }),
          controller.signal,
        );
        requireActiveAction(mountedRef, controller.signal);
        setError(null);
      } catch (tutorialError) {
        if (actionIsActive(mountedRef, controller.signal)) {
          setError(errorMessage(tutorialError, "Failed to save first-run widget selection"));
        }
        throw tutorialError;
      } finally {
        actionControllersRef.current.delete(controller);
      }
    });
  }, [enqueueOperation, persistThenApply]);

  useEffect(() => {
    if (!mountedRef.current) return;
    void emit(LAYOUT_STATE_EVENT, { layout, editSession, overflowCount });
  }, [editSession, layout, overflowCount]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(LAYOUT_ACTION_EVENT, (event) => {
      if (!active || !event.payload || typeof event.payload !== "object") return;
      const action = event.payload as Record<string, unknown>;
      const widgetId = typeof action.widgetId === "string"
        && OPTIONAL_WIDGET_IDS.includes(action.widgetId as WidgetWindowId)
        ? action.widgetId as WidgetWindowId
        : null;
      switch (action.type) {
        case "enter":
          void enterEdit();
          break;
        case "commit":
          void commitEdit();
          break;
        case "cancel":
          void cancelEdit();
          break;
        case "reset":
          void resetEdit();
          break;
        case "update-placement":
          if (widgetId && action.changes && typeof action.changes === "object") {
            void updatePlacement(widgetId, action.changes as Partial<Omit<WidgetPlacement, "widgetId">>);
          }
          break;
        case "cycle-size":
          if (widgetId) {
            const placement = editSessionRef.current?.candidate.placements
              .find((item) => item.widgetId === widgetId);
            const sizes: WidgetPlacement["size"][] = ["compact", "standard", "tall", "wide"];
            const index = placement ? sizes.indexOf(placement.size) : -1;
            void updatePlacement(widgetId, { size: sizes[(index + 1) % sizes.length] ?? "compact" });
          }
          break;
        case "drag-complete":
          if (widgetId) void completeDrag(widgetId);
          break;
        case "request-state":
          void emit(LAYOUT_STATE_EVENT, { layout: layoutRef.current, editSession: editSessionRef.current, overflowCount });
          break;
        default:
          break;
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [cancelEdit, commitEdit, completeDrag, enterEdit, overflowCount, resetEdit, updatePlacement]);

  return {
    layout,
    editSession,
    overflowCount,
    loading,
    error,
    degraded,
    toggleSide,
    openSettings,
    enterEdit,
    commitEdit,
    cancelEdit,
    hideWidget,
    updatePlacement,
    resetEdit,
    completeDrag,
    applyTutorialSelection,
  };
}

export interface UseLayoutSettingsActionsReturn {
  layout: ClusterLayoutV1 | null;
  editMode: boolean;
  overflowCount: number;
  enterEdit: () => Promise<void>;
  commitEdit: () => Promise<void>;
  cancelEdit: () => Promise<void>;
  resetEdit: () => Promise<void>;
  updatePlacement: (
    widgetId: WidgetWindowId,
    changes: Partial<Omit<WidgetPlacement, "widgetId">>,
  ) => Promise<void>;
}

export function useLayoutSettingsActions(): UseLayoutSettingsActionsReturn {
  const [layout, setLayout] = useState<ClusterLayoutV1 | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [overflowCount, setOverflowCount] = useState(0);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<unknown>(LAYOUT_STATE_EVENT, (event) => {
      if (!active || !event.payload || typeof event.payload !== "object") return;
      const payload = event.payload as Record<string, unknown>;
      const parsedLayout = ClusterLayoutV1Schema.safeParse(payload.layout);
      if (!parsedLayout.success) return;
      setLayout(parsedLayout.data);
      setEditMode(parsedLayout.data.editMode);
      setOverflowCount(
        typeof payload.overflowCount === "number" && Number.isInteger(payload.overflowCount)
          ? Math.max(0, payload.overflowCount)
          : 0,
      );
    }).then((stop) => {
      if (active) {
        unlisten = stop;
        void emit(LAYOUT_ACTION_EVENT, { type: "request-state" });
      } else {
        stop();
      }
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => emit(LAYOUT_ACTION_EVENT, payload), []);
  return {
    layout,
    editMode,
    overflowCount,
    enterEdit: () => send({ type: "enter" }),
    commitEdit: () => send({ type: "commit" }),
    cancelEdit: () => send({ type: "cancel" }),
    resetEdit: () => send({ type: "reset" }),
    updatePlacement: (widgetId, changes) => send({ type: "update-placement", widgetId, changes }),
  };
}

export interface UseWidgetWindowActionsReturn {
  editMode: boolean;
  hideWidget: (widgetId: WidgetWindowId) => Promise<void>;
  beginDrag: (widgetId: WidgetWindowId) => Promise<void>;
  cycleSize: (widgetId: WidgetWindowId) => Promise<void>;
}

export function useWidgetWindowActions(): UseWidgetWindowActionsReturn {
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  const mountedRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const actionControllersRef = useRef(new Set<AbortController>());

  useEffect(() => {
    mountedRef.current = true;
    let editUnlisten: (() => void) | undefined;
    let stateUnlisten: (() => void) | undefined;
    const updateEditMode = (enabled: boolean) => {
      if (!mountedRef.current) return;
      editModeRef.current = enabled;
      setEditMode(enabled);
    };
    void listen<boolean>("cluster-edit-mode", (event) => {
      if (typeof event.payload === "boolean") updateEditMode(event.payload);
    }).then((stop) => {
      if (mountedRef.current) editUnlisten = stop;
      else stop();
    }).catch(() => undefined);
    void listen<unknown>(LAYOUT_STATE_EVENT, (event) => {
      if (!event.payload || typeof event.payload !== "object") return;
      const parsed = ClusterLayoutV1Schema.safeParse(
        (event.payload as Record<string, unknown>).layout,
      );
      if (parsed.success) updateEditMode(parsed.data.editMode);
    }).then((stop) => {
      if (mountedRef.current) {
        stateUnlisten = stop;
        void emit(LAYOUT_ACTION_EVENT, { type: "request-state" });
      } else stop();
    }).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      editUnlisten?.();
      stateUnlisten?.();
      for (const controller of actionControllersRef.current) controller.abort();
      actionControllersRef.current.clear();
    };
  }, []);

  const hideWidget = useCallback((widgetId: WidgetWindowId): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve();
    if (editModeRef.current) {
      return emit(LAYOUT_ACTION_EVENT, {
        type: "update-placement",
        widgetId,
        changes: { visible: false },
      });
    }
    const execute = async () => {
      if (!mountedRef.current) return;
      const controller = new AbortController();
      actionControllersRef.current.add(controller);
      try {
        requireActiveAction(mountedRef, controller.signal);
        const current = await loadLayout(controller.signal);
        requireActiveAction(mountedRef, controller.signal);
        await saveLayout(hidePlacement(current, widgetId), controller.signal);
        requireActiveAction(mountedRef, controller.signal);
      } catch {
        // The optional root has no cluster state owner; the daemon/main root remain authoritative.
      } finally {
        actionControllersRef.current.delete(controller);
      }
    };
    const result = operationQueueRef.current.then(execute, execute);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const beginDrag = useCallback(async (widgetId: WidgetWindowId) => {
    if (!mountedRef.current || !editModeRef.current) return;
    await getCurrentWindow().startDragging();
    if (!mountedRef.current || !editModeRef.current) return;
    await emit(LAYOUT_ACTION_EVENT, { type: "drag-complete", widgetId });
  }, []);

  const cycleSize = useCallback(async (widgetId: WidgetWindowId) => {
    if (!mountedRef.current || !editModeRef.current) return;
    await emit(LAYOUT_ACTION_EVENT, { type: "cycle-size", widgetId });
  }, []);

  return { editMode, hideWidget, beginDrag, cycleSize };
}
