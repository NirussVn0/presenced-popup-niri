import { useEffect } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, Settings, X } from "lucide-react";
import { WindowControls } from "./components/WindowControls.js";
import { TutorialOverlay } from "./components/TutorialOverlay.js";
import { EditHandles } from "./components/EditHandles.js";
import { usePresenceCompanion } from "./hooks/usePresenceCompanion.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWidgetConfig } from "./hooks/useWidgetConfig.js";
import { useWindowCluster } from "./hooks/useWindowCluster.js";
import { springNiri, springSnap } from "./lib/animations.js";
import { CountdownWidget } from "./widgets/CountdownWidget.js";
import { LyricsWidget } from "./widgets/LyricsWidget.js";
import { MusicWidget } from "./widgets/MusicWidget.js";
import { PomodoroWidget } from "./widgets/PomodoroWidget.js";
import { PremiumClock } from "./widgets/PremiumClock.js";
import { RvcWidget } from "./widgets/RvcWidget.js";

export function App() {
  const {
    snapshot,
    wsConnected,
    startPomodoro,
    pausePomodoro,
    resumePomodoro,
    stopPomodoro,
    skipPomodoro,
    playPauseMedia,
    nextMedia,
    previousMedia,
  } = usePresenceCompanion();
  const { visibility } = useWidgetConfig();
  const { theme } = useTheme();
  const {
    layout,
    loading: clusterLoading,
    error: clusterError,
    degraded: clusterDegraded,
    toggleSide,
    openSettings,
    enterEdit,
    commitEdit,
    cancelEdit,
  } = useWindowCluster();
  const editMode = layout?.editMode ?? false;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "<") {
        event.preventDefault();
        void toggleSide("left");
      }
      if (event.key === "ArrowRight" || event.key === ">") {
        event.preventDefault();
        void toggleSide("right");
      }
      if (event.key === "Escape" && editMode) {
        event.preventDefault();
        void cancelEdit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelEdit, editMode, toggleSide]);

  const isMusicPlaying = snapshot?.media?.playback === "playing";

  return (
    <>
      <TutorialOverlay />
      <div className="relative h-screen w-screen select-none overflow-hidden p-2 font-sans">
        <div className="flex h-full w-full min-w-0 flex-col gap-2">
          <motion.div
            className="glass-strong flex items-center justify-between rounded-niri-xl p-3"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springNiri}
          >
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="glass-surface rounded-niri px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
                aria-label="Toggle left widget windows"
                disabled={clusterLoading || !layout}
                onClick={() => void toggleSide("left")}
              >
                &lt;
              </button>
              <PremiumClock
                userName="Niruss"
                wsConnected={wsConnected}
                clockStyle={theme.clockStyle}
              />
            </div>
            <div className="flex items-center gap-1">
              {editMode ? (
                <>
                  <motion.button
                    type="button"
                    onClick={() => void commitEdit()}
                    className="rounded-niri bg-accent-primary/20 p-1.5 text-accent-primary"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    transition={springSnap}
                    title="Commit widget layout"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={() => void cancelEdit()}
                    className="glass-surface rounded-niri p-1.5 text-text-secondary hover:text-text-primary"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    transition={springSnap}
                    title="Cancel widget layout editing"
                  >
                    <X className="h-3.5 w-3.5" />
                  </motion.button>
                </>
              ) : (
                <motion.button
                  type="button"
                  onClick={() => void enterEdit()}
                  className="glass-surface rounded-niri p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  transition={springSnap}
                  title="Edit widgets"
                  disabled={clusterLoading || !layout}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </motion.button>
              )}
              <motion.button
                type="button"
                onClick={() => void openSettings()}
                className="glass-surface rounded-niri p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-40"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={springSnap}
                title="Open settings"
                disabled={clusterLoading}
              >
                <Settings className="h-3.5 w-3.5" />
              </motion.button>
              <WindowControls />
              <button
                type="button"
                className="glass-surface rounded-niri px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
                aria-label="Toggle right widget windows"
                disabled={clusterLoading || !layout}
                onClick={() => void toggleSide("right")}
              >
                &gt;
              </button>
            </div>
          </motion.div>

          {(clusterLoading || clusterError || clusterDegraded) && (
            <div
              className={`flex-shrink-0 rounded-niri px-2 py-1 text-center text-2xs ${
                clusterError ? "bg-status-error/15 text-status-error" : "bg-status-degraded/15 text-status-degraded"
              }`}
              role={clusterError ? "alert" : "status"}
            >
              {clusterError ?? clusterDegraded ?? "Initializing window cluster…"}
            </div>
          )}

          <motion.div
            className="grid min-h-0 min-w-0 flex-1 gap-2"
            style={{
              gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
              gridTemplateRows: "auto auto",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={springNiri}
          >
            <div className="relative min-w-0 overflow-hidden">
              {visibility.music && (
                <MusicWidget
                  media={snapshot?.media}
                  onPlayPause={playPauseMedia}
                  onNext={nextMedia}
                  onPrevious={previousMedia}
                />
              )}
              {editMode && <EditHandles />}
            </div>
            <div className="relative min-w-0 overflow-hidden">
              <RvcWidget
                connected={wsConnected}
                status={snapshot?.presence?.title ?? undefined}
                clientId="15403406"
                displayMode={isMusicPlaying ? "music" : "auto"}
              />
              {editMode && <EditHandles />}
            </div>

            <div className="relative col-span-2 min-w-0 overflow-hidden">
              {visibility.lyrics && (
                <LyricsWidget lyrics={snapshot?.lyrics} media={snapshot?.media} />
              )}
              {visibility.pomodoro && !visibility.lyrics && (
                <PomodoroWidget
                  pomodoro={snapshot?.pomodoro}
                  onStart={startPomodoro}
                  onPause={pausePomodoro}
                  onResume={resumePomodoro}
                  onStop={stopPomodoro}
                  onSkip={skipPomodoro}
                />
              )}
              {visibility.countdown && !visibility.lyrics && !visibility.pomodoro && (
                <CountdownWidget countdown={snapshot?.countdown} />
              )}
              {editMode && <EditHandles />}
            </div>
          </motion.div>

          <div className="flex-shrink-0 text-center font-mono text-2xs text-text-muted">
            <span
              className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-status-connected" : "bg-status-degraded"
              }`}
            />
            presenced v0.6.0
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
