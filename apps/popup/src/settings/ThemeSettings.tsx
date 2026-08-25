/**
 * ThemeSettings — color, glass, clock style configuration.
 *
 * Edits preview locally (debounced CSS-variable application, no network);
 * persistence happens only on explicit save via the daemon PUT.
 */
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { springSnap } from "../lib/animations.js";
import { THEME_PRESETS } from "../lib/theme-presets.js";
import { DEFAULT_THEME as HOOK_DEFAULT, applyTheme } from "../hooks/useTheme.js";
import type { ThemeConfig } from "../hooks/useTheme.js";

interface ThemeSettingsProps {
  onSave: (config: ThemeConfig) => Promise<void>;
  onLoad: () => Promise<ThemeConfig>;
  degraded?: boolean;
}

const PREVIEW_DEBOUNCE_MS = 150;

export const ThemeSettings = ({ onSave, onLoad, degraded = false }: ThemeSettingsProps) => {
  const [config, setConfig] = useState<ThemeConfig>(HOOK_DEFAULT);
  const [saved, setSaved] = useState(false);
  const persistedRef = useRef<ThemeConfig>(HOOK_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    onLoad().then((loaded) => {
      if (cancelled) return;
      persistedRef.current = loaded;
      setConfig(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [onLoad]);

  // Debounced local preview — never touches the network.
  useEffect(() => {
    const timer = setTimeout(() => applyTheme(config), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [config]);

  // Restore the last persisted theme when leaving without saving.
  useEffect(
    () => () => {
      applyTheme(persistedRef.current);
    },
    []
  );

  const update = (updates: Partial<ThemeConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = async () => {
    await onSave(config);
    persistedRef.current = config;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3 text-2xs">
      <h3 className="font-bold text-text-primary">Theme</h3>

      <p role="status" className="text-text-muted">
        {degraded
          ? "Daemon offline — editing against the cached theme."
          : "Synced with daemon theme."}
      </p>

      {/* Accent color */}
      <div className="space-y-1.5">
        <label className="text-text-secondary font-semibold">Accent Color</label>
        <div className="flex items-center gap-2">
          <input type="color" value={config.accentColor} onChange={(e) => update({ accentColor: e.target.value })} className="w-8 h-8 rounded-niri border border-border cursor-pointer" />
          <input type="text" value={config.accentColor} onChange={(e) => update({ accentColor: e.target.value })} className="flex-1 px-2 py-1 text-2xs bg-surface-solid border border-border rounded-niri text-text-primary font-mono focus:outline-none focus:border-accent-primary" />
        </div>
      </div>

      {/* Presets */}
      <div className="space-y-1.5">
        <label className="text-text-secondary font-semibold">Presets</label>
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button key={preset.name} type="button" onClick={() => update({ accentColor: preset.color })} className={`flex items-center gap-1.5 px-2 py-1 rounded-niri text-2xs transition-colors ${config.accentColor === preset.color ? "ring-2 ring-accent-primary" : "glass-surface hover:bg-surface-hover"}`}>
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: preset.color }} />
              <span className="text-text-primary">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Glass opacity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-text-secondary font-semibold">Glass Opacity</label>
          <span className="text-text-muted font-mono">{config.glassOpacity}%</span>
        </div>
        <input type="range" min="10" max="80" value={config.glassOpacity} onChange={(e) => update({ glassOpacity: Number(e.target.value) })} className="w-full accent-accent-primary" />
      </div>

      {/* Blur intensity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-text-secondary font-semibold">Blur Intensity</label>
          <span className="text-text-muted font-mono">{config.blurIntensity}px</span>
        </div>
        <input type="range" min="8" max="40" value={config.blurIntensity} onChange={(e) => update({ blurIntensity: Number(e.target.value) })} className="w-full accent-accent-primary" />
      </div>

      {/* Border style */}
      <div className="space-y-1.5">
        <label className="text-text-secondary font-semibold">Border Style</label>
        <div className="flex gap-1.5">
          {(["subtle", "glowing", "neon"] as const).map((style) => (
            <button key={style} type="button" onClick={() => update({ borderStyle: style })} className={`px-3 py-1 rounded-niri text-2xs capitalize transition-colors ${config.borderStyle === style ? "bg-accent-primary text-white font-bold" : "glass-surface text-text-secondary hover:text-text-primary"}`}>
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* Clock style */}
      <div className="space-y-1.5">
        <label className="text-text-secondary font-semibold">Clock Style</label>
        <div className="flex gap-1.5">
          {(["digital", "analog", "minimal"] as const).map((style) => (
            <button key={style} type="button" onClick={() => update({ clockStyle: style })} className={`px-3 py-1 rounded-niri text-2xs capitalize transition-colors ${config.clockStyle === style ? "bg-accent-primary text-white font-bold" : "glass-surface text-text-secondary hover:text-text-primary"}`}>
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* Save */}
      <motion.button type="button" onClick={handleSave} className="w-full py-1.5 rounded-niri bg-accent-primary hover:bg-accent-glow text-white font-bold text-2xs transition-colors" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={springSnap}>
        {saved ? "✓ Saved" : "Save Theme"}
      </motion.button>
    </div>
  );
};
