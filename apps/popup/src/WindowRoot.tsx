import type { ComponentType, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { App } from "./App.js";
import { usePresenceCompanion } from "./hooks/usePresenceCompanion.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWidgetConfig } from "./hooks/useWidgetConfig.js";
import { SettingsPanel } from "./settings/SettingsPanel.js";
import { CountdownWidget } from "./widgets/CountdownWidget.js";
import { LyricsWidget } from "./widgets/LyricsWidget.js";
import { MusicWidget } from "./widgets/MusicWidget.js";
import { PomodoroWidget } from "./widgets/PomodoroWidget.js";
import { RvcWidget } from "./widgets/RvcWidget.js";
import { SystemWidget } from "./widgets/SystemWidget.js";
import { WidgetWindowShell } from "./widgets/WidgetWindowShell.js";

function MainDashboard() {
  return <App />;
}

function OptionalDaemonContent({
  snapshotAvailable,
  error,
  children,
}: {
  snapshotAvailable: boolean;
  error: string | null;
  children: ReactNode;
}) {
  if (snapshotAvailable) return children;
  return (
    <div
      className="glass-surface flex h-full min-h-0 items-center justify-center rounded-niri p-3 text-center"
      data-widget-state="unavailable"
    >
      <div>
        <p className="text-xs font-semibold text-status-degraded">Daemon data unavailable</p>
        <p className="mt-1 text-2xs text-text-muted">
          {error ?? "Waiting for a validated daemon snapshot."}
        </p>
      </div>
    </div>
  );
}

function MusicWidgetWindow() {
  const { snapshot, error, playPauseMedia, nextMedia, previousMedia } = usePresenceCompanion();
  return (
    <WidgetWindowShell widgetId="music" title="Music">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <MusicWidget
          media={snapshot?.media}
          onPlayPause={playPauseMedia}
          onNext={nextMedia}
          onPrevious={previousMedia}
        />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function RvcWidgetWindow() {
  const { snapshot, wsConnected, error } = usePresenceCompanion();
  const isMusicPlaying = snapshot?.media?.playback === "playing";
  return (
    <WidgetWindowShell widgetId="rvc" title="Discord RPC">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <RvcWidget
          connected={wsConnected}
          status={snapshot?.presence?.title ?? undefined}
          clientId="15403406"
          displayMode={isMusicPlaying ? "music" : "auto"}
        />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function LyricsWidgetWindow() {
  const { snapshot, error } = usePresenceCompanion();
  return (
    <WidgetWindowShell widgetId="lyrics" title="Lyrics">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <LyricsWidget lyrics={snapshot?.lyrics} media={snapshot?.media} />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function SystemWidgetWindow() {
  const { snapshot, error } = usePresenceCompanion();
  return (
    <WidgetWindowShell widgetId="system" title="System">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <SystemWidget system={snapshot?.system} />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function CountdownWidgetWindow() {
  const { snapshot, error } = usePresenceCompanion();
  return (
    <WidgetWindowShell widgetId="countdown" title="Countdown">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <CountdownWidget countdown={snapshot?.countdown} />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function PomodoroWidgetWindow() {
  const {
    snapshot,
    error,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    stopPomodoro,
    skipPomodoro,
  } = usePresenceCompanion();
  return (
    <WidgetWindowShell widgetId="pomodoro" title="Pomodoro">
      <OptionalDaemonContent snapshotAvailable={snapshot !== null} error={error}>
        <PomodoroWidget
          pomodoro={snapshot?.pomodoro}
          onStart={startPomodoro}
          onPause={pausePomodoro}
          onResume={resumePomodoro}
          onStop={stopPomodoro}
          onSkip={skipPomodoro}
        />
      </OptionalDaemonContent>
    </WidgetWindowShell>
  );
}

function QuoteWidgetWindow() {
  return (
    <WidgetWindowShell widgetId="quote" title="Quote">
      <div className="glass-surface flex h-full min-h-0 items-center justify-center rounded-niri p-3 text-center">
        <div>
          <p className="text-xs font-semibold text-text-secondary">Quote feed unavailable</p>
          <p className="mt-1 text-2xs text-text-muted">
            The daemon does not expose a live quote payload yet.
          </p>
        </div>
      </div>
    </WidgetWindowShell>
  );
}

function SettingsWindow() {
  const {
    snapshot,
    setPrivacyMode,
    addCountdown,
    deleteCountdown,
    toggleCountdown,
    getDiscordConfig,
    saveDiscordConfig,
    getRvcConfig,
    saveRvcConfig,
  } = usePresenceCompanion();
  const { visibility, toggleWidget } = useWidgetConfig();
  const { loadTheme, saveTheme, degraded: themeDegraded } = useTheme();
  const closeSettings = () => {
    void invoke("close_window").catch((error: unknown) => {
      console.error("[presenced-popup] close_window failed", error);
    });
  };

  return (
    <main
      className="glass-strong flex h-screen w-screen min-w-0 flex-col overflow-hidden rounded-niri-xl p-3"
      data-window-content="settings"
    >
      <header className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <h1 className="text-xs font-semibold text-text-primary">Settings</h1>
        <button
          type="button"
          className="glass-surface rounded-niri p-1 text-text-muted hover:text-text-primary"
          aria-label="Close settings"
          onClick={closeSettings}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingsPanel
          visibility={visibility}
          toggleWidget={toggleWidget}
          onClose={closeSettings}
          snapshot={snapshot}
          onSetPrivacyMode={setPrivacyMode}
          onAddCountdown={addCountdown}
          onDeleteCountdown={deleteCountdown}
          onToggleCountdown={toggleCountdown}
          getDiscordConfig={getDiscordConfig}
          saveDiscordConfig={saveDiscordConfig}
          getRvcConfig={getRvcConfig}
          saveRvcConfig={saveRvcConfig}
          loadTheme={loadTheme}
          saveTheme={saveTheme}
          themeDegraded={themeDegraded}
        />
      </div>
    </main>
  );
}

const WINDOW_COMPONENTS = {
  "widget-main": MainDashboard,
  "widget-music": MusicWidgetWindow,
  "widget-rvc": RvcWidgetWindow,
  "widget-lyrics": LyricsWidgetWindow,
  "widget-system": SystemWidgetWindow,
  "widget-countdown": CountdownWidgetWindow,
  "widget-pomodoro": PomodoroWidgetWindow,
  "widget-quote": QuoteWidgetWindow,
  settings: SettingsWindow,
} satisfies Record<string, ComponentType>;

function UnsupportedWindow({ label }: { label: string }) {
  return (
    <main
      className="glass-strong flex h-screen w-screen flex-col items-center justify-center overflow-hidden rounded-niri-xl p-4 text-center"
      data-window-content="unsupported"
    >
      <h1 className="text-sm font-semibold text-status-degraded">Unsupported window</h1>
      <p className="mt-1 max-w-full truncate font-mono text-2xs text-text-muted">{label}</p>
    </main>
  );
}

export function WindowRoot() {
  const label = getCurrentWindow().label;
  const Component = WINDOW_COMPONENTS[label as keyof typeof WINDOW_COMPONENTS];
  return Component ? <Component /> : <UnsupportedWindow label={label} />;
}
