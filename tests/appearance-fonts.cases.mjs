import { describe, expect, it } from "vitest";
import {
  appearanceFontMax,
  appearanceFontMin,
  clampAppearanceFont,
  defaultAppearance,
  defaultAppearanceFonts,
  effectiveAppearance,
  mergeAppearanceFonts,
  normalizeAppearance,
  normalizeAppearanceFonts,
  normalizeProjectAppearanceOverride,
} from "../packages/core/modules/appearance/index.ts";

describe("appearance fonts", () => {
  it("clamps sizes to the allowed range", () => {
    expect(clampAppearanceFont(10, 13)).toBe(appearanceFontMin);
    expect(clampAppearanceFont(21, 13)).toBe(appearanceFontMax);
    expect(clampAppearanceFont(15.6, 13)).toBe(16);
    expect(clampAppearanceFont("14", 13)).toBe(13);
  });

  it("normalizes partial and empty payloads to defaults", () => {
    expect(normalizeAppearanceFonts(undefined)).toEqual({ ...defaultAppearanceFonts });
    expect(normalizeAppearanceFonts({ chat: 18, editor: 9 })).toEqual({
      chat: 18,
      editor: appearanceFontMin,
      terminal: defaultAppearanceFonts.terminal,
    });
  });

  it("merges only provided keys and keeps the colour scheme", () => {
    const current = { chat: 12, editor: 14, terminal: 16 };
    expect(mergeAppearanceFonts(current, { editor: 18 })).toEqual({
      chat: 12,
      editor: 18,
      terminal: 16,
    });
    expect(normalizeAppearance({ choice: "light", fonts: { chat: 15 } })).toEqual({
      choice: "light",
      themeSettings: {},
      fonts: {
        chat: 15,
        editor: defaultAppearanceFonts.editor,
        terminal: defaultAppearanceFonts.terminal,
      },
    });
  });

  it("applies a project override only for set fields", () => {
    const global = {
      choice: defaultAppearance,
      fonts: { chat: 13, editor: 13, terminal: 13 },
    };
    const override = normalizeProjectAppearanceOverride({
      choice: "contrast",
      fonts: { chat: 18 },
    });
    expect(override).toEqual({ choice: "contrast", fonts: { chat: 18 } });
    expect(effectiveAppearance(global, override)).toEqual({
      choice: "contrast",
      fonts: { chat: 18, editor: 13, terminal: 13 },
    });
    expect(effectiveAppearance(global, undefined)).toEqual(global);
  });
});
