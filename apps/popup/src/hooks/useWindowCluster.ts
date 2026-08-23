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

async function loadLayout(): Promise<ClusterLayoutV1> {
  const response = await fetch(LAYOUT_URL);
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

export function useWindowCluster(): UseWindowClusterReturn {
  const [layout, setLayout] = useState<ClusterLayoutV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const layoutRef = useRef<ClusterLayoutV1 | null>(null);
  const committedLayoutRef = useRef<ClusterLayoutV1 | null>(null);

  const acceptCommittedLayout = useCallback((next: ClusterLayoutV1) => {
    layoutRef.current = next;
    committedLayoutRef.current = next;
    setLayout(next);
  }, []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;

    const start = async () => {
      try {
        const initialLayout = await loadLayout();
        await invoke("initialize_widget_windows", { layout: initialLayout });
        if (!active) return;
        acceptCommittedLayout(initialLayout);
        setError(null);

        socket = new WebSocket(LAYOUT_EVENTS_URL);
        socket.onopen = () => {
          if (active) setDegraded(null);
        };
        socket.onmessage = (event) => {
          if (!active || typeof event.data !== "string") return;
          try {
            const daemonEvent = DaemonEventSchema.safeParse(JSON.parse(event.data));
            if (!daemonEvent.success || daemonEvent.data.type !== "widget.layout.changed") return;
            const next = daemonEvent.data.payload;
            acceptCommittedLayout(next);
            void invoke("apply_widget_layout", { layout: next }).catch((applyError: unknown) => {
              if (active) {
                setError(errorMessage(applyError, "Failed to apply daemon widget layout"));
              }
            });
          } catch {
            // Ignore malformed frames; only validated daemon evidence changes layout.
          }
        };
        socket.onerror = () => {
          if (active) setDegraded(LAYOUT_STREAM_LIMITATION);
        };
        socket.onclose = () => {
          if (active) setDegraded(LAYOUT_STREAM_LIMITATION);
        };
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
      socket?.close();
    };
  }, [acceptCommittedLayout]);

  const runAction = useCallback(async (action: () => Promise<void>, fallback: string) => {
    try {
      await action();
      setError(null);
    } catch (actionError) {
      setError(errorMessage(actionError, fallback));
    }
  }, []);

  const toggleSide = useCallback(async (side: WidgetSide) => {
    await runAction(async () => {
      const current = layoutRef.current;
      if (!current) throw new Error("Window cluster layout is not loaded");
      const currentlyVisible = side === "left" ? current.leftVisible : current.rightVisible;
      const next = setSideVisible(current, side, !currentlyVisible);
      await invoke("set_cluster_visibility", { side, visible: !currentlyVisible });
      acceptCommittedLayout(await saveLayout(next));
    }, `Failed to toggle ${side} cluster windows`);
  }, [acceptCommittedLayout, runAction]);

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
      const next = { ...current, editMode: true };
      layoutRef.current = next;
      setLayout(next);
    }, "Failed to enter cluster edit mode");
  }, [runAction]);

  const commitEdit = useCallback(async () => {
    await runAction(async () => {
      const current = layoutRef.current;
      if (!current) throw new Error("Window cluster layout is not loaded");
      const saved = await saveLayout({ ...current, editMode: false });
      await invoke("apply_widget_layout", { layout: saved });
      acceptCommittedLayout(saved);
    }, "Failed to commit cluster layout");
  }, [acceptCommittedLayout, runAction]);

  const cancelEdit = useCallback(async () => {
    await runAction(async () => {
      const committed = committedLayoutRef.current;
      if (!committed) throw new Error("No committed window cluster layout is available");
      const restored = { ...committed, editMode: false };
      await invoke("apply_widget_layout", { layout: restored });
      layoutRef.current = restored;
      setLayout(restored);
    }, "Failed to cancel cluster layout editing");
  }, [runAction]);

  const hideWidget = useCallback(async (widgetId: WidgetWindowId) => {
    await runAction(async () => {
      const current = layoutRef.current;
      if (!current) throw new Error("Window cluster layout is not loaded");
      await invoke("hide_widget_window", { widgetId });
      acceptCommittedLayout(await saveLayout(hidePlacement(current, widgetId)));
    }, `Failed to hide ${widgetId} widget`);
  }, [acceptCommittedLayout, runAction]);

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
