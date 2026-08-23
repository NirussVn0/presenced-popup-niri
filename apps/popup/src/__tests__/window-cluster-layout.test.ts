import { describe, expect, it } from "vitest";
import {
  createTutorialLayout,
  findNearestSlot,
  insertPlacement,
  projectClusterLayout,
  resetCandidateLayout,
  snapDraggedPlacement,
} from "../lib/window-cluster-layout.js";

const main = { x: 600, y: 330, width: 720, height: 420 };
const output = { x: 0, y: 0, width: 1920, height: 1080 };

it("projects left and right windows without touching main", () => {
  const projected = projectClusterLayout({
    version: 1,
    leftVisible: true,
    rightVisible: true,
    editMode: false,
    placements: [
      { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
      { widgetId: "rvc", side: "right", order: 0, lane: "top", size: "standard", visible: true },
    ],
  }, main, output);
  expect(projected.main).toEqual(main);
  expect(projected.widgets.music!.x + projected.widgets.music!.width).toBe(main.x - 10);
  expect(projected.widgets.rvc!.x).toBe(main.x + main.width + 10);
});

it("pushes occupied slots outward", () => {
  const next = insertPlacement(["music", "system"], "rvc", 0);
  expect(next).toEqual(["rvc", "music", "system"]);
});

it("snaps only within 24 pixels", () => {
  expect(findNearestSlot({ x: 350, y: 330 }, [{ id: "L1", x: 360, y: 330 }], 24)?.id).toBe("L1");
  expect(findNearestSlot({ x: 300, y: 330 }, [{ id: "L1", x: 360, y: 330 }], 24)).toBeNull();
});

describe("projectClusterLayout bounds and collision behavior", () => {
  it("clamps projected widgets to the output and reports overflow", () => {
    const projected = projectClusterLayout({
      version: 1,
      leftVisible: true,
      rightVisible: false,
      editMode: false,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "wide", visible: true },
        { widgetId: "system", side: "left", order: 1, lane: "top", size: "standard", visible: true },
      ],
    }, { x: 400, y: 40, width: 300, height: 420 }, { x: 0, y: 0, width: 800, height: 600 });

    expect(projected.widgets.music).toMatchObject({ x: 70, y: 40, width: 320, height: 180 });
    expect(projected.widgets.system).toMatchObject({ x: 0, y: 40, width: 250, height: 190 });
    expect(projected.overflowWidgetIds).toEqual(["system"]);
  });

  it("projects lanes around the main centerline", () => {
    const projected = projectClusterLayout({
      version: 1,
      leftVisible: true,
      rightVisible: true,
      editMode: false,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "middle", size: "compact", visible: true },
        { widgetId: "lyrics", side: "right", order: 0, lane: "bottom", size: "tall", visible: true },
      ],
    }, main, output);

    expect(projected.widgets.music).toMatchObject({ x: 370, y: 470, width: 220, height: 140 });
    expect(projected.widgets.lyrics).toMatchObject({ x: 1330, y: 510, width: 250, height: 240 });
  });

  it("omits hidden placements and hidden sides", () => {
    const projected = projectClusterLayout({
      version: 1,
      leftVisible: false,
      rightVisible: true,
      editMode: false,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
        { widgetId: "rvc", side: "right", order: 0, lane: "top", size: "standard", visible: false },
      ],
    }, main, output);

    expect(projected.widgets).toEqual({});
    expect(projected.overflowWidgetIds).toEqual([]);
  });
});

describe("findNearestSlot", () => {
  it("chooses the closest slot, including diagonal distance", () => {
    expect(findNearestSlot({ x: 350, y: 350 }, [
      { id: "far", x: 360, y: 365 },
      { id: "near", x: 360, y: 355 },
    ], 24)?.id).toBe("near");
  });

  it("uses the default threshold when one is not supplied", () => {
    expect(findNearestSlot({ x: 350, y: 330 }, [{ id: "L1", x: 360, y: 330 }])?.id).toBe("L1");
  });
});

it("inserts at the requested index after removing an existing occurrence", () => {
  expect(insertPlacement(["music", "system", "rvc"], "system", 2)).toEqual(["music", "rvc", "system"]);
});

describe("magnetic candidate helpers", () => {
  const occupied = {
    version: 1 as const,
    leftVisible: true,
    rightVisible: false,
    editMode: true,
    placements: [
      { widgetId: "music" as const, side: "left" as const, order: 0, lane: "top" as const, size: "standard" as const, visible: true },
      { widgetId: "system" as const, side: "left" as const, order: 1, lane: "top" as const, size: "compact" as const, visible: true },
      { widgetId: "rvc" as const, side: "right" as const, order: 0, lane: "top" as const, size: "standard" as const, visible: true },
    ],
  };

  it("inserts a dragged placement into an occupied slot and pushes existing orders", () => {
    const snapped = snapDraggedPlacement(occupied, "rvc", {
      dragged: { x: 345, y: 334, width: 250, height: 190 },
      main,
      output,
    });

    expect(snapped?.placements.filter((placement) => placement.side === "left"))
      .toEqual([
        expect.objectContaining({ widgetId: "rvc", order: 0, lane: "top" }),
        expect.objectContaining({ widgetId: "music", order: 1 }),
        expect.objectContaining({ widgetId: "system", order: 2 }),
      ]);
  });

  it("rejects out-of-bounds and distant drops", () => {
    expect(snapDraggedPlacement(occupied, "rvc", {
      dragged: { x: -20, y: 330, width: 250, height: 190 },
      main,
      output,
    })).toBeNull();
    expect(snapDraggedPlacement(occupied, "rvc", {
      dragged: { x: 900, y: 40, width: 250, height: 190 },
      main,
      output,
    })).toBeNull();
  });

  it("resets the candidate to main-only edit mode", () => {
    expect(resetCandidateLayout()).toEqual({
      version: 1,
      leftVisible: false,
      rightVisible: false,
      editMode: true,
      placements: [],
    });
  });

  it("creates one valid deterministic tutorial layout from explicit selections", () => {
    expect(createTutorialLayout(["music", "lyrics"])).toEqual({
      version: 1,
      leftVisible: true,
      rightVisible: true,
      editMode: false,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
        { widgetId: "lyrics", side: "right", order: 0, lane: "bottom", size: "tall", visible: true },
      ],
    });
    expect(createTutorialLayout([])).toEqual({
      version: 1,
      leftVisible: false,
      rightVisible: false,
      editMode: false,
      placements: [],
    });
  });
});
