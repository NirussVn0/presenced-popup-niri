import { createRequire } from "node:module";
import type { ReactTestRenderer } from "react-test-renderer";
import type { ClusterLayoutV1 } from "@presenced/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
});

const { act, create } = createRequire(import.meta.url)(
  "react-test-renderer/cjs/react-test-renderer.development.js",
) as typeof import("react-test-renderer");

import { TutorialOverlay } from "../components/TutorialOverlay.js";
import { LayoutSettings } from "../settings/LayoutSettings.js";

const layout: ClusterLayoutV1 = {
  version: 1,
  leftVisible: true,
  rightVisible: false,
  editMode: true,
  placements: [
    { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
  ],
};

let renderer: ReactTestRenderer | null;
const storage = new Map<string, string>();

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  renderer = null;
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount());
  }
  vi.unstubAllGlobals();
});

describe("LayoutSettings", () => {
  it("offers only fixed side, order, lane, size, and visibility controls", async () => {
    const onChange = vi.fn();
    await act(async () => {
      renderer = create(
        <LayoutSettings layout={layout} overflowCount={0} onChange={onChange} onReset={vi.fn()} />,
      );
    });

    expect(renderer!.root.findAllByType("input").filter((input) => input.props.type === "number"))
      .toHaveLength(0);
    const side = renderer!.root.findByProps({ "aria-label": "Music side" });
    const order = renderer!.root.findByProps({ "aria-label": "Music order" });
    const lane = renderer!.root.findByProps({ "aria-label": "Music lane" });
    const size = renderer!.root.findByProps({ "aria-label": "Music size preset" });
    const visible = renderer!.root.findByProps({ "aria-label": "Music visible" });

    expect(size.props.children.map((option: { props: { value: string } }) => option.props.value))
      .toEqual(["compact", "standard", "tall", "wide"]);
    await act(async () => side.props.onChange({ target: { value: "right" } }));
    await act(async () => order.props.onChange({ target: { value: "2" } }));
    await act(async () => lane.props.onChange({ target: { value: "bottom" } }));
    await act(async () => size.props.onChange({ target: { value: "wide" } }));
    await act(async () => visible.props.onChange({ target: { checked: false } }));

    expect(onChange.mock.calls).toEqual([
      ["music", { side: "right" }],
      ["music", { order: 2 }],
      ["music", { lane: "bottom" }],
      ["music", { size: "wide" }],
      ["music", { visible: false }],
    ]);
  });

  it("reports overflow and exposes a deterministic main-only reset", async () => {
    const onReset = vi.fn();
    await act(async () => {
      renderer = create(
        <LayoutSettings layout={layout} overflowCount={3} onChange={vi.fn()} onReset={onReset} />,
      );
    });

    expect(renderer!.root.findByProps({ role: "status" }).props.children.join(""))
      .toContain("3 windows overflow");
    const reset = renderer!.root.findByProps({ "aria-label": "Reset layout to main only" });
    await act(async () => reset.props.onClick());
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe("TutorialOverlay first-run layout selection", () => {
  it("defaults to main-only and finishes with only explicitly selected optional windows", async () => {
    const onFinish = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderer = create(<TutorialOverlay onFinish={onFinish} onSkip={onSkip} />);
    });

    const music = renderer!.root.findByProps({ "aria-label": "Show Music Player window" });
    const lyrics = renderer!.root.findByProps({ "aria-label": "Show Lyrics window" });
    expect(music.props.checked).toBe(false);
    expect(lyrics.props.checked).toBe(false);

    await act(async () => music.props.onChange({ target: { checked: true } }));
    await act(async () => renderer!.root.findByProps({ "aria-label": "Finish tutorial" }).props.onClick());

    expect(onFinish).toHaveBeenCalledWith(["music"]);
    expect(onSkip).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith("presenced-tutorial-seen", "true");
  });

  it("keeps the seen marker unset and tutorial open when saving fails", async () => {
    const onFinish = vi.fn().mockRejectedValue(new Error("layout save failed"));
    const onSkip = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderer = create(<TutorialOverlay onFinish={onFinish} onSkip={onSkip} />);
    });

    await act(async () => renderer!.root.findByProps({ "aria-label": "Finish tutorial" }).props.onClick());

    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ role: "alert" }).props.children).toBe("layout save failed");
    expect(renderer!.root.findByProps({ "aria-label": "Finish tutorial" })).toBeDefined();
  });

  it("skip writes the main-only selection and leaves every optional window hidden", async () => {
    const onFinish = vi.fn().mockResolvedValue(undefined);
    const onSkip = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      renderer = create(<TutorialOverlay onFinish={onFinish} onSkip={onSkip} />);
    });

    await act(async () => renderer!.root.findByProps({ "aria-label": "Skip optional windows" }).props.onClick());

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith("presenced-tutorial-seen", "true");
  });
});
