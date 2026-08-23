import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/WindowControls.tsx", import.meta.url), "utf8");

describe("WindowControls", () => {
  it("uses the official Tauri invoke bridge for close and minimize", () => {
    expect(source).toContain('from "@tauri-apps/api/core"');
    expect(source).toContain('invokeWindowCommand("minimize_window")');
    expect(source).toContain('invokeWindowCommand("close_window")');
    expect(source).not.toContain("window.__TAURI__");
  });
});
