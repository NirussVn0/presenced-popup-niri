import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("Niri popup integration", () => {
  it("ships a floating rule for the runtime app id and fixed popup size", () => {
    const rule = rootFile("niri/presenced-popup-niri.kdl");
    const cargoManifest = rootFile("apps/popup/src-tauri/Cargo.toml");
    const runtimeAppId = cargoManifest.match(/^name = "([^"]+)"$/m)?.[1];

    expect(runtimeAppId).toBeDefined();
    expect(rule).toContain(`match app-id="^${runtimeAppId}$"`);
    expect(rule).toContain("open-floating true");
    expect(rule).toContain("open-focused true");
    expect(rule).toContain("default-column-width { fixed 720; }");
    expect(rule).toContain("default-window-height { fixed 420; }");
    expect(rule).not.toContain("default-floating-position center");
  });

  it("installs and validates the compositor rule automatically", () => {
    const installer = rootFile("scripts/install.sh");
    const desktopEntry = rootFile("systemd/io.niruss.presenced-popup-niri.desktop");
    const rustEntrypoint = rootFile("apps/popup/src-tauri/src/lib.rs");
    const clusterRuntime = rootFile("apps/popup/src-tauri/src/window_cluster.rs");
    const tauriConfig = JSON.parse(rootFile("apps/popup/src-tauri/tauri.conf.json"));

    expect(installer).toContain("niri/presenced-popup-niri.kdl");
    expect(installer).toContain('niri validate -c "$NIRI_CONFIG"');
    expect(desktopEntry).toContain("Exec=presenced-popup-niri");
    expect(desktopEntry).toContain("StartupWMClass=presenced-popup-niri");
    expect(rustEntrypoint).toContain("mod window_cluster;");
    expect(rustEntrypoint).toContain("window_cluster::initialize_widget_windows");
    expect(rustEntrypoint).toContain(".setup(window_cluster::setup)");
    expect(clusterRuntime).toContain("fn find_niri_windows");
    expect(clusterRuntime).toContain("fn center_main_window_on_niri");
    expect(clusterRuntime).toContain('"center-window"');
    expect(tauriConfig.app.windows[0].center).toBe(true);
    expect(tauriConfig.app.windows[0].alwaysOnTop).toBe(true);
    expect(tauriConfig.app.windows[0].skipTaskbar).toBe(true);
  });

  it("grants every cluster webview the Tauri permissions it uses", () => {
    const capability = JSON.parse(
      rootFile("apps/popup/src-tauri/capabilities/widget-cluster.json"),
    );

    expect(capability.windows).toContain("widget-*");
    expect(capability.windows).toContain("settings");
    expect(capability.permissions).toContain("core:default");
    expect(capability.permissions).toContain("core:event:allow-emit");
  });
});
