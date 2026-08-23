import { createRequire } from "node:module";
import type { ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
});

const { act, create } = createRequire(import.meta.url)(
  "react-test-renderer/cjs/react-test-renderer.development.js",
) as typeof import("react-test-renderer");

const cluster = vi.hoisted(() => ({ hideWidget: vi.fn() }));

vi.mock("../hooks/useWindowCluster.js", () => ({
  useWindowCluster: () => ({ hideWidget: cluster.hideWidget }),
}));

import { WidgetWindowShell } from "../widgets/WidgetWindowShell.js";

let renderer: ReactTestRenderer | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  renderer = null;
  cluster.hideWidget.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
  }
});

describe("WidgetWindowShell", () => {
  it("routes its close control through the persisted cluster hide action", async () => {
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
});
