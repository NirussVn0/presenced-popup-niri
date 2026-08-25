import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_SETTINGS,
  DaemonEventSchema,
  ThemeSettingsV1Schema,
  migrateThemeSettings,
} from "../index.js";

describe("ThemeSettingsV1 contract", () => {
  it("validates the canonical default theme settings", () => {
    expect(ThemeSettingsV1Schema.parse(DEFAULT_THEME_SETTINGS)).toEqual({
      version: 1,
      accentColor: "#7c8aff",
      glassOpacity: 45,
      blurIntensity: 24,
      borderStyle: "subtle",
      clockStyle: "digital",
    });
  });

  it("rejects out-of-range glass opacity, negative blur, and bad hex", () => {
    expect(
      ThemeSettingsV1Schema.safeParse({ ...DEFAULT_THEME_SETTINGS, glassOpacity: 101 }).success
    ).toBe(false);
    expect(
      ThemeSettingsV1Schema.safeParse({ ...DEFAULT_THEME_SETTINGS, glassOpacity: -1 }).success
    ).toBe(false);
    expect(
      ThemeSettingsV1Schema.safeParse({ ...DEFAULT_THEME_SETTINGS, blurIntensity: -1 }).success
    ).toBe(false);
    expect(
      ThemeSettingsV1Schema.safeParse({ ...DEFAULT_THEME_SETTINGS, accentColor: "blue" }).success
    ).toBe(false);
    expect(
      ThemeSettingsV1Schema.safeParse({
        ...DEFAULT_THEME_SETTINGS,
        version: 2,
      }).success
    ).toBe(false);
  });

  it("migrates a legacy localStorage-shaped partial object", () => {
    expect(migrateThemeSettings({ accentColor: "#34d399" })).toEqual({
      version: 1,
      accentColor: "#34d399",
      glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
      blurIntensity: DEFAULT_THEME_SETTINGS.blurIntensity,
      borderStyle: DEFAULT_THEME_SETTINGS.borderStyle,
      clockStyle: DEFAULT_THEME_SETTINGS.clockStyle,
    });
  });

  it("coerces string numbers into numeric fields", () => {
    const migrated = migrateThemeSettings({ glassOpacity: "60.5", blurIntensity: "12" });
    expect(migrated.glassOpacity).toBe(60.5);
    expect(migrated.blurIntensity).toBe(12);
  });

  it("clamps glass opacity into the 0–100 range and rejects negative blur", () => {
    expect(migrateThemeSettings({ glassOpacity: "250" }).glassOpacity).toBe(100);
    expect(migrateThemeSettings({ glassOpacity: "-20" }).glassOpacity).toBe(0);
    expect(migrateThemeSettings({ blurIntensity: -5 }).blurIntensity).toBe(
      DEFAULT_THEME_SETTINGS.blurIntensity
    );
  });

  it("falls back to defaults for invalid enums, colors, and non-object input", () => {
    expect(migrateThemeSettings({ borderStyle: "chunky" }).borderStyle).toBe("subtle");
    expect(migrateThemeSettings({ clockStyle: "sundial" }).clockStyle).toBe("digital");
    expect(migrateThemeSettings({ accentColor: "#zzzzzz" }).accentColor).toBe("#7c8aff");
    expect(migrateThemeSettings(null)).toEqual(DEFAULT_THEME_SETTINGS);
    expect(migrateThemeSettings(undefined)).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("accepts the migrated output through the strict v1 schema", () => {
    const migrated = migrateThemeSettings({ accentColor: "#A78BFA", clockStyle: "analog" });
    expect(() => ThemeSettingsV1Schema.parse(migrated)).not.toThrow();
    expect(migrated.accentColor).toBe("#a78bfa");
    expect(migrated.clockStyle).toBe("analog");
  });
});

describe("theme broadcast event contract", () => {
  it("parses a theme.settings.changed daemon event", () => {
    const parsed = DaemonEventSchema.safeParse({
      type: "theme.settings.changed",
      payload: DEFAULT_THEME_SETTINGS,
    });
    expect(parsed.success).toBe(true);
  });
});
