import { z } from "zod";

export const ThemeBorderStyleSchema = z.enum(["subtle", "glowing", "neon"]);
export const ThemeClockStyleSchema = z.enum(["digital", "analog", "minimal"]);
export const AccentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ThemeSettingsV1Schema = z
  .object({
    version: z.literal(1),
    accentColor: AccentColorSchema,
    glassOpacity: z.number().min(0).max(100),
    blurIntensity: z.number().min(0),
    borderStyle: ThemeBorderStyleSchema,
    clockStyle: ThemeClockStyleSchema,
  })
  .strict();

export type ThemeSettingsV1 = z.infer<typeof ThemeSettingsV1Schema>;

export const DEFAULT_THEME_SETTINGS: ThemeSettingsV1 = {
  version: 1,
  accentColor: "#7c8aff",
  glassOpacity: 45,
  blurIntensity: 24,
  borderStyle: "subtle",
  clockStyle: "digital",
};

const GLASS_OPACITY_MIN = 0;
const GLASS_OPACITY_MAX = 100;

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * migrateThemeSettings — accepts legacy partial/localStorage-shaped theme
 * objects and fills every missing or invalid field from the v1 defaults.
 * Never throws; always returns a canonical ThemeSettingsV1.
 */
export function migrateThemeSettings(input: unknown): ThemeSettingsV1 {
  const source =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

  const glassOpacityRaw = coerceNumber(source.glassOpacity);
  const blurIntensityRaw = coerceNumber(source.blurIntensity);

  const accentColor =
    typeof source.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.accentColor)
      ? source.accentColor.toLowerCase()
      : DEFAULT_THEME_SETTINGS.accentColor;

  const borderStyle = ThemeBorderStyleSchema.safeParse(source.borderStyle);
  const clockStyle = ThemeClockStyleSchema.safeParse(source.clockStyle);

  return {
    version: 1,
    accentColor,
    glassOpacity:
      glassOpacityRaw === undefined
        ? DEFAULT_THEME_SETTINGS.glassOpacity
        : clamp(glassOpacityRaw, GLASS_OPACITY_MIN, GLASS_OPACITY_MAX),
    blurIntensity:
      blurIntensityRaw === undefined || blurIntensityRaw < 0
        ? DEFAULT_THEME_SETTINGS.blurIntensity
        : blurIntensityRaw,
    borderStyle: borderStyle.success ? borderStyle.data : DEFAULT_THEME_SETTINGS.borderStyle,
    clockStyle: clockStyle.success ? clockStyle.data : DEFAULT_THEME_SETTINGS.clockStyle,
  };
}
