import type { ReactNode } from "react";
import type { WidgetWindowId } from "@presenced/contracts";
import { GripHorizontal, Scaling, X } from "lucide-react";
import { useWidgetWindowActions } from "../hooks/useWindowCluster.js";

interface WidgetWindowShellProps {
  widgetId: WidgetWindowId;
  title: string;
  children: ReactNode;
}

export function WidgetWindowShell({ widgetId, title, children }: WidgetWindowShellProps) {
  const { editMode, hideWidget, beginDrag, cycleSize } = useWidgetWindowActions();
  const hide = () => {
    void hideWidget(widgetId);
  };

  return (
    <section
      className="glass-strong flex h-screen w-screen min-w-0 flex-col overflow-hidden rounded-niri-xl p-2"
      data-widget-window={widgetId}
    >
      <header className="mb-1 flex flex-shrink-0 items-center justify-between gap-2 px-1">
        <h1 className="truncate text-2xs font-semibold text-text-secondary">{title}</h1>
        <div className="flex items-center gap-1">
          {editMode && (
            <>
              <button
                type="button"
                className="glass-surface cursor-grab rounded-niri p-1 text-accent-primary active:cursor-grabbing"
                aria-label={`Drag ${title}`}
                onPointerDown={() => void beginDrag(widgetId)}
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="glass-surface rounded-niri p-1 text-accent-primary"
                aria-label={`Cycle ${title} size preset`}
                onClick={() => void cycleSize(widgetId)}
              >
                <Scaling className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded-niri p-1 text-text-muted transition-colors hover:text-text-primary"
            aria-label={`Hide ${title}`}
            onClick={hide}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
