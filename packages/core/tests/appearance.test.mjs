import { expect, test } from "vite-plus/test";
import {
  frozenGlass,
  frozenGlassPalette,
  frozenGlassSeeds,
  hctFromHex,
  hexFromHct,
  hueDistance,
} from "../modules/appearance/index.ts";
import { mergeThemeValues, validateThemeSettings } from "../modules/plugins/index.ts";

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("HCT round-trips Frozen Glass colours and keeps tone when hue shifts", () => {
  const accent = hctFromHex("#a4e1ff");
  expect(hexFromHct(accent.h, accent.c, accent.t)).toBe("#a4e1ff");
  expect(accent.h).toBeGreaterThan(210);
  expect(accent.h).toBeLessThan(250);
  const shifted = hctFromHex(hexFromHct(accent.h + 40, accent.c, accent.t));
  expect(Math.abs(shifted.t - accent.t)).toBeLessThan(1.5);
  expect(hueDistance(shifted.h, accent.h + 40)).toBeLessThan(4);
});

test("Frozen Glass rebuilds CSS tokens from a cool HCT seed", () => {
  expect(frozenGlassSeeds.map((option) => option.id)).toEqual([
    "ice",
    "arctic",
    "lagoon",
    "indigo",
  ]);
  expect(validateThemeSettings([...frozenGlass.settings])).toMatchObject(
    frozenGlass.settings.map(({ id, kind }) => ({ id, kind })),
  );
  const ice = frozenGlassPalette("ice");
  expect(ice["--accent"]).toBe("#a4e1ff");
  expect(ice["--bg"]).toBe("#101e2f");
  expect(ice["--err"]).toBe("#ffc0c9");
  for (const seed of frozenGlassSeeds) {
    const palette = frozenGlassPalette(seed.id);
    for (const surface of ["--bg", "--bg-2", "--bg-3", "--bg-4"])
      for (const ink of ["--text", "--text-2", "--muted", "--faint", "--accent", "--info"])
        expect(
          contrastRatio(palette[ink], palette[surface]),
          `${seed.id}: ${ink} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
  }
  const indigo = frozenGlassPalette("indigo");
  expect(indigo["--err"]).toBe(ice["--err"]);
  expect(indigo["--run"]).toBe(ice["--run"]);
  expect(indigo["--accent"]).not.toBe(ice["--accent"]);
  expect(hueDistance(hctFromHex(indigo["--accent"]).h, hctFromHex("#cbd8fa").h)).toBeLessThan(4);
  expect(Math.abs(hctFromHex(indigo["--accent"]).t - hctFromHex(ice["--accent"]).t)).toBeLessThan(
    1.5,
  );
  expect(mergeThemeValues(frozenGlass.settings, undefined, { seed: "lagoon" }).seed).toBe("lagoon");
  expect(() => mergeThemeValues(frozenGlass.settings, undefined, { seed: "sunset" })).toThrow(
    /опорный цвет/i,
  );
});
