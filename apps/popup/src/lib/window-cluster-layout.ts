import type { ClusterLayoutV1, WidgetPlacement, WidgetSizePreset } from "@presenced/contracts";

export const CLUSTER_GAP = 10;
export const SNAP_THRESHOLD = 24;
export const SIZE_PRESETS = {
  compact: { width: 220, height: 140 },
  standard: { width: 250, height: 190 },
  tall: { width: 250, height: 240 },
  wide: { width: 320, height: 180 },
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectedWidget extends Rect {
  widgetId: WidgetPlacement["widgetId"];
  side: WidgetPlacement["side"];
  order: number;
  lane: WidgetPlacement["lane"];
  size: WidgetSizePreset;
}

export interface ProjectedClusterLayout {
  main: Rect;
  widgets: Partial<Record<WidgetPlacement["widgetId"], ProjectedWidget>>;
  overflowWidgetIds: WidgetPlacement["widgetId"][];
}

export interface SlotPoint {
  id: string;
  x: number;
  y: number;
}

function clampRect(rect: Rect, output: Rect): Rect {
  const width = Math.min(rect.width, output.width);
  const height = Math.min(rect.height, output.height);
  return {
    x: Math.max(output.x, Math.min(rect.x, output.x + output.width - width)),
    y: Math.max(output.y, Math.min(rect.y, output.y + output.height - height)),
    width,
    height,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function laneY(lane: WidgetPlacement["lane"], main: Rect, height: number): number {
  switch (lane) {
    case "top":
      return main.y;
    case "middle":
      return main.y + (main.height - height) / 2;
    case "bottom":
      return main.y + main.height - height;
    default:
      return main.y;
  }
}

function projectDesiredRect(
  placement: WidgetPlacement,
  main: Rect,
  precedingWidth: number,
): Rect {
  const preset = SIZE_PRESETS[placement.size];
  const x = placement.side === "left"
    ? main.x - CLUSTER_GAP - preset.width - precedingWidth
    : main.x + main.width + CLUSTER_GAP + precedingWidth;

  return { x, y: laneY(placement.lane, main, preset.height), ...preset };
}

export function projectClusterLayout(
  layout: ClusterLayoutV1,
  main: Rect,
  output: Rect,
): ProjectedClusterLayout {
  const widgets: Partial<Record<WidgetPlacement["widgetId"], ProjectedWidget>> = {};
  const overflowWidgetIds: WidgetPlacement["widgetId"][] = [];
  const occupiedBySide: Record<WidgetPlacement["side"], number> = { left: 0, right: 0 };
  const projectedRects: Rect[] = [main];

  const placements = [...layout.placements].sort((a, b) => (
    a.side.localeCompare(b.side) || a.order - b.order
  ));
  for (const placement of placements) {
    if (!placement.visible || (placement.side === "left" ? !layout.leftVisible : !layout.rightVisible)) {
      continue;
    }

    const desired = projectDesiredRect(placement, main, occupiedBySide[placement.side] ?? 0);
    const rect = clampRect(desired, output);
    const overflow = desired.x < output.x
      || desired.y < output.y
      || desired.x + desired.width > output.x + output.width
      || desired.y + desired.height > output.y + output.height
      || projectedRects.some((occupied) => overlaps(rect, occupied));

    widgets[placement.widgetId] = { ...rect, ...placement };
    if (overflow) {
      overflowWidgetIds.push(placement.widgetId);
    }
    projectedRects.push(rect);
    occupiedBySide[placement.side] = (occupiedBySide[placement.side] ?? 0)
      + desired.width + CLUSTER_GAP;
  }

  return { main, widgets, overflowWidgetIds };
}

export function insertPlacement(order: string[], widgetId: string, index: number): string[] {
  const withoutWidget = order.filter((id) => id !== widgetId);
  return [
    ...withoutWidget.slice(0, index),
    widgetId,
    ...withoutWidget.slice(index),
  ];
}

export function findNearestSlot(
  point: Pick<SlotPoint, "x" | "y">,
  slots: SlotPoint[],
  threshold = SNAP_THRESHOLD,
): SlotPoint | null {
  let nearest: SlotPoint | null = null;
  let nearestDistance = threshold;
  for (const slot of slots) {
    const distance = Math.hypot(point.x - slot.x, point.y - slot.y);
    if (distance <= nearestDistance) {
      nearest = slot;
      nearestDistance = distance;
    }
  }
  return nearest;
}
