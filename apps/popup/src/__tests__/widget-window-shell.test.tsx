import { createRequire } from "node:module";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
});

const { act, create } = createRequire(import.meta.url)(
  "react-test-renderer/cjs/react-test-renderer.development.js",
) as typeof import("react-test-renderer");

const cluster = vi.hoisted(() => ({
  hideWidget: vi.fn(),
  beginDrag: vi.fn(),
  cycleSize: vi.fn(),
  editMode: false,
}));

vi.mock("../hooks/useWindowCluster.js", () => ({
  useWidgetWindowActions: () => ({
    hideWidget: cluster.hideWidget,
    beginDrag: cluster.beginDrag,
    cycleSize: cluster.cycleSize,
    editMode: cluster.editMode,
  }),
}));

import { WidgetWindowShell } from "../widgets/WidgetWindowShell.js";

let renderer: ReactTestRenderer | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  renderer = null;
  cluster.hideWidget.mockReset().mockResolvedValue(undefined);
  cluster.beginDrag.mockReset().mockResolvedValue(undefined);
  cluster.cycleSize.mockReset().mockResolvedValue(undefined);
  cluster.editMode = false;
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
  }
});

describe("WidgetWindowShell", () => {
  it("routes its close control through the lightweight persisted hide action", async () => {
    await act(async () => {
      renderer = create(
        <WidgetWindowShell widgetId="music" title="Music">
          <div>content</div>
        </WidgetWindowShell>,
      );
    });

    const close = renderer!.root.findByProps({ "aria-label": "Hide Music" });
    await act(async () => close.props.onClick());

    expect(cluster.hideWidget).toHaveBeenCalledOnce();
    expect(cluster.hideWidget).toHaveBeenCalledWith("music");
  });

  it("hides drag and fixed-preset resize affordances in normal mode", async () => {
    await act(async () => {
      renderer = create(
        <WidgetWindowShell widgetId="music" title="Music"><div>content</div></WidgetWindowShell>,
      );
    });

    expect(renderer!.root.findAllByProps({ "aria-label": "Drag Music" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "Cycle Music size preset" })).toHaveLength(0);
  });

  it("exposes drag and fixed-preset resize actions only in edit mode", async () => {
    cluster.editMode = true;
    await act(async () => {
      renderer = create(
        <WidgetWindowShell widgetId="music" title="Music"><div>content</div></WidgetWindowShell>,
      );
    });

    const drag = renderer!.root.findByProps({ "aria-label": "Drag Music" });
    const resize = renderer!.root.findByProps({ "aria-label": "Cycle Music size preset" });
    await act(async () => drag.props.onPointerDown());
    await act(async () => resize.props.onClick());

    expect(cluster.beginDrag).toHaveBeenCalledWith("music");
    expect(cluster.cycleSize).toHaveBeenCalledWith("music");
  });
});
