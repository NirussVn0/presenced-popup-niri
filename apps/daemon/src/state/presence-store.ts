import { EventEmitter } from "node:events";
import {
  DesktopFact,
  MediaFact,
  LyricsPayload,
  PomodoroFact,
  CountdownFact,
  SystemFact,
  SceneState,
  SceneType,
  ManualOverride,
  PresenceRules,
  PresenceSnapshot,
  ResolvedPresence,
  IntegrationHealth,
  DaemonEvent,
  DEFAULT_PRIORITIES,
  ClusterLayoutV1,
  ClusterLayoutV1Schema,
  DEFAULT_CLUSTER_LAYOUT,
  ThemeSettingsV1,
  migrateThemeSettings,
} from "@presenced/contracts";
import { resolvePresence, ResolverResult, SceneResolver } from "@presenced/core";

import { DatabaseManager } from "./database.js";

export interface PresenceStoreOptions {
  focusDebounceMs?: number;
  initialRules?: PresenceRules;
  database?: DatabaseManager;
}

export class PresenceStore extends EventEmitter {
  private desktop: DesktopFact | null = null;
  private media: MediaFact | null = null;
  private lyrics: LyricsPayload | null = null;
  private pomodoro: PomodoroFact | null = null;
  private countdown: CountdownFact | null = null;
  private system: SystemFact | null = null;
  private manualOverride: ManualOverride | null = null;
  private privacyMode = false;
  private manualSceneType: SceneType = "auto";
  private health: Record<string, IntegrationHealth> = {};
  private rules: PresenceRules;
  private presence: ResolvedPresence | null = null;
  private candidates: ResolverResult["candidates"] = [];
  private revision = 0;
  private database: DatabaseManager | null = null;
  private sceneResolver = new SceneResolver();

  private readonly focusDebounceMs: number;
  private focusDebounceTimer: NodeJS.Timeout | null = null;
  private pendingDesktopFact: DesktopFact | null = null;

  constructor(options: PresenceStoreOptions = {}) {
    super();
    this.focusDebounceMs = options.focusDebounceMs ?? 150;
    this.database = options.database ?? null;

    if (this.database) {
      this.rules = options.initialRules ?? this.database.getRules();
      this.privacyMode = this.database.getPrivacyMode();
      this.manualOverride = this.database.getManualOverride();
    } else {
      this.rules = options.initialRules ?? {
        priorities: { ...DEFAULT_PRIORITIES },
        appRules: {},
        privacyMode: false,
      };
    }
  }

  public getSnapshot(): PresenceSnapshot {
    const resolvedScene = this.sceneResolver.resolve({
      manualSceneType: this.manualSceneType,
      privacyMode: this.privacyMode,
      override: this.manualOverride,
      desktop: this.desktop,
      media: this.media,
      pomodoro: this.pomodoro,
      countdown: this.countdown,
      system: this.system,
    });

    const sceneState: SceneState = {
      activeSceneId: resolvedScene.id,
      activeSceneType: resolvedScene.type,
      isAuto: resolvedScene.isAuto,
      scenes: [],
      updatedAt: Date.now(),
    };

    return {
      presence: this.presence,
      candidates: this.candidates,
      desktop: this.desktop,
      media: this.media,
      lyrics: this.lyrics,
      pomodoro: this.pomodoro,
      countdown: this.countdown,
      system: this.system,
      scene: sceneState,
      health: { ...this.health },
      privacyMode: this.privacyMode,
      override: this.manualOverride,
      updatedAt: Date.now(),
    };
  }

  public getHealth(): Record<string, IntegrationHealth> {
    return { ...this.health };
  }

  public getRules(): PresenceRules {
    return { ...this.rules };
  }

  public setRules(rules: PresenceRules): void {
    this.rules = rules;
    this.database?.saveRules(rules);
    this.recompute();
  }

  public getDiscordConfig(): { clientId?: string; socketPath?: string } {
    return this.database?.getDiscordConfig() ?? {};
  }

  public setDiscordConfig(config: { clientId?: string; socketPath?: string }): void {
    this.database?.saveDiscordConfig(config);
  }

  public getRvcConfig(): { enabled: boolean; tickIntervalSec: number; entries: any[] } | null {
    return this.database?.getRvcConfig() ?? null;
  }

  public setRvcConfig(config: { enabled: boolean; tickIntervalSec: number; entries: any[] }): void {
    this.database?.saveRvcConfig(config);
  }

  public getWidgetLayout(): ClusterLayoutV1 {
    return this.database?.getKvParsed("widget-layout-v1", ClusterLayoutV1Schema) ?? DEFAULT_CLUSTER_LAYOUT;
  }

  public setWidgetLayout(layout: ClusterLayoutV1): void {
    this.database?.setKv("widget-layout-v1", layout);
    const event: DaemonEvent = {
      type: "widget.layout.changed",
      payload: layout,
    };
    this.emit("event", event);
  }

  public getThemeSettings(): ThemeSettingsV1 {
    return this.database?.getThemeSettings() ?? migrateThemeSettings(null);
  }

  public setThemeSettings(theme: ThemeSettingsV1): ThemeSettingsV1 {
    let canonical: ThemeSettingsV1;
    if (this.database) {
      this.database.putThemeSettings(theme);
      canonical = this.database.getThemeSettings();
    } else {
      canonical = migrateThemeSettings(theme);
    }
    const event: DaemonEvent = {
      type: "theme.settings.changed",
      payload: canonical,
    };
    this.emit("event", event);
    return canonical;
  }

  public setHealth(health: IntegrationHealth): void {
    this.health[health.source] = health;
    const event: DaemonEvent = {
      type: "source.health.changed",
      payload: health,
    };
    this.emit("event", event);
  }

  public setScene(sceneType: SceneType): void {
    this.manualSceneType = sceneType;
    this.recompute();
    const event: DaemonEvent = {
      type: "state.snapshot",
      payload: this.getSnapshot(),
    };
    this.emit("event", event);
  }

  public getSceneType(): SceneType {
    return this.manualSceneType;
  }

  public setPomodoro(fact: PomodoroFact | null): void {
    this.pomodoro = fact;
    this.recompute();
    const event: DaemonEvent = {
      type: "state.snapshot",
      payload: this.getSnapshot(),
    };
    this.emit("event", event);
  }

  public setCountdown(fact: CountdownFact | null): void {
    this.countdown = fact;
    this.recompute();
    const event: DaemonEvent = {
      type: "state.snapshot",
      payload: this.getSnapshot(),
    };
    this.emit("event", event);
  }

  public setSystem(fact: SystemFact | null): void {
    this.system = fact;
    const event: DaemonEvent = {
      type: "state.snapshot",
      payload: this.getSnapshot(),
    };
    this.emit("event", event);
  }

  public setDesktop(fact: DesktopFact | null, immediate = false): void {
    if (immediate || this.focusDebounceMs === 0) {
      if (this.focusDebounceTimer) {
        clearTimeout(this.focusDebounceTimer);
        this.focusDebounceTimer = null;
      }
      this.applyDesktop(fact);
      return;
    }

    this.pendingDesktopFact = fact;
    if (this.focusDebounceTimer) {
      clearTimeout(this.focusDebounceTimer);
    }

    this.focusDebounceTimer = setTimeout(() => {
      this.focusDebounceTimer = null;
      this.applyDesktop(this.pendingDesktopFact);
    }, this.focusDebounceMs);
  }

  private applyDesktop(fact: DesktopFact | null): void {
    this.desktop = fact;
    const event: DaemonEvent = {
      type: "desktop.changed",
      payload: fact,
    };
    this.emit("event", event);
    this.recompute();
  }

  public setMedia(fact: MediaFact | null): void {
    this.media = fact;
    const event: DaemonEvent = {
      type: "media.changed",
      payload: fact,
    };
    this.emit("event", event);
    this.recompute();
  }

  public setLyrics(lyrics: LyricsPayload | null): void {
    this.lyrics = lyrics;
    const event: DaemonEvent = {
      type: "lyrics.changed",
      payload: lyrics,
    };
    this.emit("event", event);
  }

  public setManualOverride(override: ManualOverride | null): void {
    this.manualOverride = override;
    this.database?.saveManualOverride(override);
    const event: DaemonEvent = {
      type: "override.changed",
      payload: override,
    };
    this.emit("event", event);
    this.recompute();
  }

  public setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
    this.database?.savePrivacyMode(enabled);
    const event: DaemonEvent = {
      type: "privacy.changed",
      payload: { enabled },
    };
    this.emit("event", event);
    this.recompute();
  }

  public recompute(): void {
    const result = resolvePresence({
      desktop: this.desktop,
      media: this.media,
      manualOverride: this.manualOverride,
      privacyMode: this.privacyMode,
      rules: this.rules,
      currentRevision: this.revision,
    });

    this.candidates = result.candidates;

    // Check if presence is different from existing
    const prev = this.presence;
    const next = result.presence;

    const isDifferent =
      (prev === null && next !== null) ||
      (prev !== null && next === null) ||
      (prev !== null &&
        next !== null &&
        (prev.candidateId !== next.candidateId ||
          prev.category !== next.category ||
          prev.title !== next.title ||
          prev.details !== next.details ||
          prev.state !== next.state));

    if (isDifferent) {
      if (next !== null) {
        this.revision += 1;
        this.presence = {
          ...next,
          revision: this.revision,
        };
        const event: DaemonEvent = {
          type: "presence.resolved",
          payload: this.presence,
        };
        this.emit("event", event);
      } else {
        this.presence = null;
        const event: DaemonEvent = {
          type: "presence.resolved",
          payload: null,
        };
        this.emit("event", event);
      }
    }
  }

  public stop(): void {
    if (this.focusDebounceTimer) {
      clearTimeout(this.focusDebounceTimer);
      this.focusDebounceTimer = null;
    }
  }
}
