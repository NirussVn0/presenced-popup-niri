/** First-run main-only tutorial with explicit optional-window selection. */
import { useEffect, useState } from "react";
import type { WidgetWindowId } from "@presenced/contracts";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, MessageSquare, Music, Shield, Sparkles, X } from "lucide-react";
import { springNiri } from "../lib/animations.js";

const TUTORIAL_KEY = "presenced-tutorial-seen";

const OPTIONAL_WINDOWS: {
  id: WidgetWindowId;
  label: string;
  description: string;
  icon: typeof Music;
}[] = [
  { id: "music", label: "Music Player", description: "Spinning vinyl + waveform", icon: Music },
  { id: "rvc", label: "Discord RPC", description: "Live status sync", icon: MessageSquare },
  { id: "lyrics", label: "Lyrics", description: "Current track lyrics", icon: Music },
  { id: "system", label: "System", description: "Host status", icon: Shield },
  { id: "countdown", label: "Countdown", description: "Upcoming dates", icon: Clock },
  { id: "pomodoro", label: "Pomodoro", description: "Focus timer", icon: Clock },
  { id: "quote", label: "Quote", description: "A quiet prompt", icon: Sparkles },
];

export interface TutorialOverlayProps {
  onFinish: (selected: WidgetWindowId[]) => Promise<void>;
  onSkip: () => Promise<void>;
  disabled?: boolean;
}

export const TutorialOverlay = ({ onFinish, onSkip, disabled = false }: TutorialOverlayProps) => {
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<WidgetWindowId[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(TUTORIAL_KEY)) setShow(true);
  }, []);

  const complete = async (action: () => Promise<void>) => {
    if (saving || disabled) return;
    setSaving(true);
    setSaveError(null);
    try {
      await action();
      localStorage.setItem(TUTORIAL_KEY, "true");
      setShow(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the first-run layout");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (widgetId: WidgetWindowId, checked: boolean) => {
    setSelected((current) => checked
      ? [...current.filter((id) => id !== widgetId), widgetId]
      : current.filter((id) => id !== widgetId));
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            className="glass-strong relative z-10 mx-4 max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-niri-xl p-6"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={springNiri}
          >
            <button
              type="button"
              aria-label="Close tutorial and keep optional windows hidden"
              onClick={() => void complete(onSkip)}
              disabled={saving || disabled}
              className="glass-surface absolute right-3 top-3 rounded-niri p-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="space-y-2 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent-primary to-scene-music-from">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-lg font-bold text-text-primary">Welcome to presenced</h2>
              <p className="text-xs text-text-secondary">
                Start main-only. Select optional magnetic windows explicitly.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {OPTIONAL_WINDOWS.map(({ id, label, description, icon: Icon }) => (
                <label key={id} className="glass-surface flex cursor-pointer items-start gap-2 rounded-niri p-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Show ${label} window`}
                    checked={selected.includes(id)}
                    disabled={saving || disabled}
                    onChange={(event) => toggle(id, event.target.checked)}
                  />
                  <span>
                    <Icon className="mb-1 h-4 w-4 text-accent-primary" />
                    <span className="block text-2xs font-bold text-text-primary">{label}</span>
                    <span className="block text-2xs text-text-muted">{description}</span>
                  </span>
                </label>
              ))}
            </div>

            {saveError && <div role="alert" className="text-center text-2xs text-status-error">{saveError}</div>}

            <button
              type="button"
              aria-label="Finish tutorial"
              disabled={saving || disabled}
              onClick={() => void complete(() => onFinish(selected))}
              className="w-full rounded-niri bg-accent-primary py-2 text-sm font-bold text-white hover:bg-accent-glow disabled:opacity-40"
            >
              {saving ? "Saving…" : selected.length === 0 ? "Continue main-only" : "Save selected windows"}
            </button>
            <button
              type="button"
              aria-label="Skip optional windows"
              disabled={saving || disabled}
              onClick={() => void complete(onSkip)}
              className="w-full text-2xs text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              Skip — keep every optional window hidden
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
