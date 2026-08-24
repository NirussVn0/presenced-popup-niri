import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DesktopFactSchema,
  MediaFactSchema,
  ActivityCandidateSchema,
  ResolvedPresenceSchema,
  PresenceSnapshotSchema,
  DaemonEventSchema,
  DEFAULT_PRIORITIES,
} from "../index.js";

describe("@presenced/contracts", () => {
  it("keeps TypeScript build metadata out of source control", () => {
    const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const trackedBuildMetadata = execFileSync("git", ["ls-files", "--", "*.tsbuildinfo"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();

    expect(trackedBuildMetadata).toBe("");
    expect(() =>
      execFileSync(
        "git",
        ["check-ignore", "--no-index", "--quiet", "packages/contracts/tsconfig.tsbuildinfo"],
        { cwd: repositoryRoot },
      ),
    ).not.toThrow();
  });

  it("bootstraps workspace declaration files before root typecheck", () => {
    const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const rootPackage = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(rootPackage.scripts.pretypecheck).toBe(
      "pnpm --filter @presenced/core... run build",
    );
  });

  it("validates DesktopFact correctly", () => {
    const valid = {
      kind: "desktop",
      appId: "org.wezfurlong.wezterm",
      workspaceId: 1,
      windowId: 42,
      rawTitle: "fish ~",
      observedAt: Date.now(),
    };
    const parsed = DesktopFactSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates MediaFact correctly", () => {
    const valid = {
      kind: "media",
      player: "spotify",
      playback: "playing",
      title: "Song Title",
      artist: "Artist Name",
      album: "Album Name",
      durationMs: 180000,
      positionAnchorMs: 30000,
      anchorMonotonicMs: 1000,
      observedAt: Date.now(),
    };
    const parsed = MediaFactSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates ResolvedPresence and reason", () => {
    const valid = {
      revision: 1,
      candidateId: "desktop-app-1",
      category: "terminal",
      title: "Terminal",
      details: "Alacritty",
      source: "niri",
      reason: "Desktop focus: terminal won at priority 25",
      resolvedAt: Date.now(),
    };
    const parsed = ResolvedPresenceSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates DaemonEvent state.snapshot", () => {
    const snapshotEvent = {
      type: "state.snapshot",
      payload: {
        presence: null,
        candidates: [],
        desktop: null,
        media: null,
        health: {
          niri: { source: "niri", status: "connected" },
        },
        privacyMode: false,
        override: null,
        updatedAt: Date.now(),
      },
    };
    const parsed = DaemonEventSchema.safeParse(snapshotEvent);
    expect(parsed.success).toBe(true);
  });

  it("contains default priorities for all categories", () => {
    expect(DEFAULT_PRIORITIES.manual).toBe(100);
    expect(DEFAULT_PRIORITIES.privacy).toBe(95);
    expect(DEFAULT_PRIORITIES.music).toBe(80);
    expect(DEFAULT_PRIORITIES.coding).toBe(60);
    expect(DEFAULT_PRIORITIES.idle).toBe(0);
  });
});
