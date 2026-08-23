import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentLabel = "widget-main";
let companionError: string | null = "daemon connection refused";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: currentLabel }),
  Window: class MockWindow {},
}));

vi.mock("../App.js", () => ({
  App: () => <main data-window-content="dashboard">Main dashboard</main>,
}));

vi.mock("../hooks/usePresenceCompanion.js", () => ({
  usePresenceCompanion: () => ({
    snapshot: null,
    wsConnected: false,
    error: companionError,
    playPauseMedia: vi.fn(),
    nextMedia: vi.fn(),
    previousMedia: vi.fn(),
    startPomodoro: vi.fn(),
    pausePomodoro: vi.fn(),
    resumePomodoro: vi.fn(),
    stopPomodoro: vi.fn(),
    skipPomodoro: vi.fn(),
    setPrivacyMode: vi.fn(),
    addCountdown: vi.fn(),
    deleteCountdown: vi.fn(),
    toggleCountdown: vi.fn(),
    getDiscordConfig: vi.fn(async () => ({})),
    saveDiscordConfig: vi.fn(async () => {}),
    getRvcConfig: vi.fn(async () => ({ enabled: false, tickIntervalSec: 30, entries: [] })),
    saveRvcConfig: vi.fn(async () => {}),
  }),
}));

import { WindowRoot } from "../WindowRoot.js";
import { hidePlacement, setSideVisible } from "../hooks/useWindowCluster.js";

const renderWindow = (label: string) => {
  currentLabel = label;
  return renderToStaticMarkup(<WindowRoot />);
};

describe("WindowRoot", () => {
  beforeEach(() => {
    currentLabel = "widget-main";
    companionError = "daemon connection refused";
  });

  it("dispatches widget-main to the compact dashboard", () => {
    const html = renderWindow("widget-main");

    expect(html).toContain('data-window-content="dashboard"');
    expect(html).toContain("Main dashboard");
  });

  it("dispatches widget-rvc to only bounded RVC content", () => {
    const html = renderWindow("widget-rvc");

    expect(html).toContain('data-widget-window="rvc"');
    expect(html).toContain("Discord RPC");
    expect(html).not.toContain('data-window-content="dashboard"');
    expect(html).not.toContain("Main dashboard");
  });

  it.each([
    ["widget-music", 'data-widget-window="music"'],
    ["widget-rvc", 'data-widget-window="rvc"'],
    ["widget-lyrics", 'data-widget-window="lyrics"'],
    ["widget-system", 'data-widget-window="system"'],
    ["widget-countdown", 'data-widget-window="countdown"'],
    ["widget-pomodoro", 'data-widget-window="pomodoro"'],
    ["widget-quote", 'data-widget-window="quote"'],
    ["settings", 'data-window-content="settings"'],
  ])("dispatches registry label %s to its bounded root", (label, marker) => {
    const html = renderWindow(label);

    expect(html).toContain(marker);
    expect(html).not.toContain('data-window-content="dashboard"');
    expect(html).not.toContain('data-window-content="unsupported"');
  });

  it("renders an explicit bounded unsupported state for an unknown label", () => {
    const html = renderWindow("widget-unknown");

    expect(html).toContain('data-window-content="unsupported"');
    expect(html).toContain("Unsupported window");
    expect(html).toContain("widget-unknown");
    expect(html).not.toContain('data-window-content="dashboard"');
  });

  it("keeps settings bounded and closable in the settings root", () => {
    const html = renderWindow("settings");

    expect(html).toContain('data-window-content="settings"');
    expect(html).toContain('aria-label="Close settings"');
    expect(html).not.toContain('data-window-content="dashboard"');
  });

  it.each(["widget-countdown", "widget-pomodoro"])(
    "renders truthful daemon-unavailable content for %s without snapshot evidence",
    (label) => {
      const html = renderWindow(label);

      expect(html).toContain('data-widget-state="unavailable"');
      expect(html).toContain("Daemon data unavailable");
      expect(html).toContain("daemon connection refused");
      expect(html).not.toContain("25:00");
      expect(html).not.toContain("Imminent");
    },
  );
});

describe("window cluster layout transitions", () => {
  const layout = {
    version: 1 as const,
    leftVisible: false,
    rightVisible: true,
    editMode: false,
    placements: [
      {
        widgetId: "music" as const,
        side: "left" as const,
        order: 0,
        lane: "top" as const,
        size: "standard" as const,
        visible: true,
      },
    ],
  };

  it("sets one cluster side without mutating the loaded layout", () => {
    const next = setSideVisible(layout, "left", true);

    expect(next).toEqual({ ...layout, leftVisible: true });
    expect(layout.leftVisible).toBe(false);
  });

  it("hides one widget placement without changing other layout fields", () => {
    const next = hidePlacement(layout, "music");

    expect(next.placements[0]?.visible).toBe(false);
    expect(layout.placements[0]?.visible).toBe(true);
    expect(next.rightVisible).toBe(true);
  });
});

describe("main window cluster wiring", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  it("boots through WindowRoot instead of mounting App in every window", () => {
    const main = source("main.tsx");

    expect(main).toContain("<WindowRoot />");
    expect(main).not.toContain("<App />");
  });

  it("uses cluster actions instead of local SidePanel state", () => {
    const app = source("App.tsx");
    const clusterHook = source("hooks/useWindowCluster.ts");

    expect(app).not.toContain("SidePanel");
    expect(app).not.toContain("leftOpen");
    expect(app).not.toContain("rightOpen");
    expect(app).toContain("toggleSide");
    expect(app).toContain("openSettings");
    expect(app).toContain("enterEdit");
    expect(app).toContain("commitEdit");
    expect(app).toContain("cancelEdit");
    expect(clusterHook).toContain('invoke("set_cluster_visibility"');
  });
});
