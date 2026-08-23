import type {
  ClusterLayoutV1,
  WidgetPlacement,
  WidgetWindowId,
} from "@presenced/contracts";
import { RotateCcw } from "lucide-react";
import { createTutorialLayout, OPTIONAL_WIDGET_IDS } from "../lib/window-cluster-layout.js";

const WIDGET_LABELS: Record<WidgetWindowId, string> = {
  music: "Music",
  rvc: "Discord RPC",
  lyrics: "Lyrics",
  system: "System",
  countdown: "Countdown",
  pomodoro: "Pomodoro",
  quote: "Quote",
};

export interface LayoutSettingsProps {
  layout: ClusterLayoutV1;
  overflowCount: number;
  onChange: (
    widgetId: WidgetWindowId,
    changes: Partial<Omit<WidgetPlacement, "widgetId">>,
  ) => void;
  onReset: () => void;
  disabled?: boolean;
}

function fallbackPlacement(widgetId: WidgetWindowId): WidgetPlacement {
  return createTutorialLayout([widgetId]).placements[0]!;
}

export function LayoutSettings({
  layout,
  overflowCount,
  onChange,
  onReset,
  disabled = false,
}: LayoutSettingsProps) {
  return (
    <div className="space-y-2" data-layout-settings>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-text-primary">Magnetic Layout</h3>
          <p className="text-text-muted">Edit fixed slots and presets. Width and height are not free-form.</p>
        </div>
        <button
          type="button"
          aria-label="Reset layout to main only"
          disabled={disabled}
          onClick={onReset}
          className="glass-surface flex items-center gap-1 rounded-niri px-2 py-1 text-text-secondary disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <div
        role="status"
        className={overflowCount > 0
          ? "rounded-niri bg-status-degraded/15 px-2 py-1 text-status-degraded"
          : "rounded-niri bg-status-connected/10 px-2 py-1 text-status-connected"}
      >
        {"Overflow: "}{overflowCount} {overflowCount === 1 ? "window overflows" : "windows overflow"}
      </div>

      <div className="space-y-1.5">
        {OPTIONAL_WIDGET_IDS.map((widgetId) => {
          const placement = layout.placements.find((item) => item.widgetId === widgetId)
            ?? { ...fallbackPlacement(widgetId), visible: false };
          const label = WIDGET_LABELS[widgetId];
          return (
            <fieldset
              key={widgetId}
              disabled={disabled}
              className="grid grid-cols-2 gap-1.5 rounded-niri border border-border-subtle p-2 sm:grid-cols-5"
            >
              <legend className="px-1 font-semibold text-text-primary">{label}</legend>
              <label className="flex items-center gap-1 text-text-secondary">
                <input
                  type="checkbox"
                  aria-label={`${label} visible`}
                  checked={placement.visible}
                  onChange={(event) => onChange(widgetId, { visible: event.target.checked })}
                />
                Visible
              </label>
              <select
                aria-label={`${label} side`}
                value={placement.side}
                onChange={(event) => onChange(widgetId, { side: event.target.value as WidgetPlacement["side"] })}
                className="rounded-niri bg-surface-solid px-1 py-0.5 text-text-primary"
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
              <select
                aria-label={`${label} order`}
                value={placement.order}
                onChange={(event) => onChange(widgetId, { order: Number(event.target.value) })}
                className="rounded-niri bg-surface-solid px-1 py-0.5 text-text-primary"
              >
                {OPTIONAL_WIDGET_IDS.map((_, order) => (
                  <option key={order} value={order}>{order + 1}</option>
                ))}
              </select>
              <select
                aria-label={`${label} lane`}
                value={placement.lane}
                onChange={(event) => onChange(widgetId, { lane: event.target.value as WidgetPlacement["lane"] })}
                className="rounded-niri bg-surface-solid px-1 py-0.5 text-text-primary"
              >
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
              <select
                aria-label={`${label} size preset`}
                value={placement.size}
                onChange={(event) => onChange(widgetId, { size: event.target.value as WidgetPlacement["size"] })}
                className="rounded-niri bg-surface-solid px-1 py-0.5 text-text-primary"
              >
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="tall">Tall</option>
                <option value="wide">Wide</option>
              </select>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
