/**
 * ThemePresets — curated accent color presets shared by theme UI.
 */

export interface ThemePreset {
  name: string;
  color: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: "Niri Blue", color: "#7c8aff" },
  { name: "Cyber Green", color: "#34d399" },
  { name: "Warm Amber", color: "#fbbf24" },
  { name: "Neon Purple", color: "#a78bfa" },
  { name: "Rose Gold", color: "#f472b6" },
];
