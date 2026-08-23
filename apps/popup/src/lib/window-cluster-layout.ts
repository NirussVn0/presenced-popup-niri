import {
  DEFAULT_CLUSTER_LAYOUT,
  type ClusterLayoutV1,
  type WidgetLane,
  type WidgetPlacement,
  type WidgetSide,
  type WidgetSizePreset,
  type WidgetWindowId,
} from "@presenced/contracts";

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

export interface DragSnapshot {
  dragged: Rect;
  main: Rect;
  output: Rect;
}

const TUTORIAL_PLACEMENTS: Record<WidgetWindowId, WidgetPlacement> = {
  music: { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
  rvc: { widgetId: "rvc", side: "right", order: 0, lane: "top", size: "standard", visible: true },
  lyrics: { widgetId: "lyrics", side: "right", order: 1, lane: "bottom", size: "tall", visible: true },
  system: { widgetId: "system", side: "left", order: 1, lane: "middle", size: "compact", visible: true },
  countdown: { widgetId: "countdown", side: "right", order: 2, lane: "middle", size: "compact", visible: true },
  pomodoro: { widgetId: "pomodoro", side: "left", order: 2, lane: "bottom", size: "tall", visible: true },
  quote: { widgetId: "quote", side: "right", order: 3, lane: "middle", size: "standard", visible: true },
};

export const OPTIONAL_WIDGET_IDS = Object.keys(TUTORIAL_PLACEMENTS) as WidgetWindowId[];

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

function normalizePlacementOrders(placements: WidgetPlacement[]): WidgetPlacement[] {
  return (["left", "right"] as const).flatMap((side) => placements
    .filter((placement) => placement.side === side)
    .sort((left, right) => left.order - right.order)
    .map((placement, order) => ({ ...placement, order })));
}

export function updateCandidatePlacement(
  layout: ClusterLayoutV1,
  widgetId: WidgetWindowId,
  changes: Partial<Omit<WidgetPlacement, "widgetId">>,
): ClusterLayoutV1 {
  const existingPlacement = layout.placements.find((placement) => placement.widgetId === widgetId);
  const existing = existingPlacement ?? { ...TUTORIAL_PLACEMENTS[widgetId], visible: false };
  const target = { ...existing, ...changes, widgetId };
  const withoutTarget = layout.placements.filter((placement) => placement.widgetId !== widgetId);
  const targetSide = target.side;
  const sideOrder = withoutTarget
    .filter((placement) => placement.side === targetSide)
    .sort((left, right) => left.order - right.order);
  const insertionIndex = Math.max(0, Math.min(target.order, sideOrder.length));
  sideOrder.splice(insertionIndex, 0, target);
  const opposite = withoutTarget.filter((placement) => placement.side !== targetSide);
  const placements = normalizePlacementOrders([...sideOrder, ...opposite]);
  const activatesSide = !existingPlacement
    || changes.visible === true
    || (changes.side !== undefined && changes.side !== existing.side);
  return {
    ...layout,
    editMode: true,
    leftVisible: activatesSide && target.side === "left" && target.visible ? true : layout.leftVisible,
    rightVisible: activatesSide && target.side === "right" && target.visible ? true : layout.rightVisible,
    placements,
  };
}

export function resetCandidateLayout(): ClusterLayoutV1 {
  return { ...DEFAULT_CLUSTER_LAYOUT, placements: [], editMode: true };
}

export function createTutorialLayout(selected: WidgetWindowId[]): ClusterLayoutV1 {
  const selectedSet = new Set(selected);
  const placements = normalizePlacementOrders(OPTIONAL_WIDGET_IDS
    .filter((widgetId) => selectedSet.has(widgetId))
    .map((widgetId) => ({ ...TUTORIAL_PLACEMENTS[widgetId] })));
  return {
    ...DEFAULT_CLUSTER_LAYOUT,
    leftVisible: placements.some((placement) => placement.side === "left"),
    rightVisible: placements.some((placement) => placement.side === "right"),
    placements,
  };
}

function rectIsFiniteAndPositive(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function rectInside(rect: Rect, output: Rect): boolean {
  return rect.x >= output.x
    && rect.y >= output.y
    && rect.x + rect.width <= output.x + output.width
    && rect.y + rect.height <= output.y + output.height;
}

interface CandidateSlot extends SlotPoint {
  layout: ClusterLayoutV1;
}

export function snapDraggedPlacement(
  layout: ClusterLayoutV1,
  widgetId: WidgetWindowId,
  snapshot: DragSnapshot,
  threshold = SNAP_THRESHOLD,
): ClusterLayoutV1 | null {
  if (![snapshot.dragged, snapshot.main, snapshot.output].every(rectIsFiniteAndPositive)
    || !rectInside(snapshot.dragged, snapshot.output)
    || !rectInside(snapshot.main, snapshot.output)
    || !layout.placements.some((placement) => placement.widgetId === widgetId)) {
    return null;
  }

  const slots: CandidateSlot[] = [];
  for (const side of ["left", "right"] as WidgetSide[]) {
    const sideCount = layout.placements.filter((placement) => (
      placement.widgetId !== widgetId && placement.side === side
    )).length;
    for (const lane of ["top", "middle", "bottom"] as WidgetLane[]) {
      for (let order = 0; order <= sideCount; order += 1) {
        const candidate = updateCandidatePlacement(layout, widgetId, {
          side,
          lane,
          order,
          visible: true,
        });
        const projection = projectClusterLayout(candidate, snapshot.main, snapshot.output);
        const projected = projection.widgets[widgetId];
        if (!projected || projection.overflowWidgetIds.includes(widgetId)) continue;
        slots.push({
          id: `${side}:${lane}:${order}`,
          x: projected.x,
          y: projected.y,
          layout: candidate,
        });
      }
    }
  }

  const nearest = findNearestSlot(snapshot.dragged, slots, threshold);
  return nearest ? slots.find((slot) => slot.id === nearest.id)?.layout ?? null : null;
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
