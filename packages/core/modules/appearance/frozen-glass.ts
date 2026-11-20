import { resolveThemeValues, type ThemeSetting, type ThemeValues } from "../plugins/index.ts";
import { hctFromHex, shiftHexHue } from "./hct.ts";

export const frozenGlassOverlayProperties = [
  "--theme-surface",
  "--theme-chrome",
  "--theme-wallpaper-overlay",
  "--theme-wallpaper-fallback",
] as const;

const iceAccent = "#a4e1ff";
const iceHue = hctFromHex(iceAccent).h;

export const frozenGlassSeeds = [
  { id: "ice", title: "Лёд", color: iceAccent },
  { id: "arctic", title: "Арктика", color: "#9ae6e8" },
  { id: "lagoon", title: "Лагуна", color: "#9fe7cf" },
  { id: "indigo", title: "Индиго", color: "#cbd8fa" },
] as const;

const template = {
  "--bg": "#101e2f",
  "--bg-2": "#172a3f",
  "--bg-3": "#20374e",
  "--bg-4": "#2a435b",
  "--bg-sunken": "#0b192a",
  "--canvas": "#0a1729",
  "--line": "#a1d8ff38",
  "--line-strong": "#b0e3ff70",
  "--text": "#eef8ff",
  "--text-2": "#d8ebf9",
  "--muted": "#bfd7e9",
  "--faint": "#afc8dc",
  "--focus": "#b4edff",
  "--accent": iceAccent,
  "--run": "#98e8ce",
  "--err": "#ffc0c9",
  "--warn": "#ffe1a9",
  "--info": "#aad7ff",
  "--search": "#455779",
  "--selection": "#315675",
  "--overlay": "#05101caa",
  "--shadow-popover": "0 12px 32px #02091780",
  "--shadow-modal": "0 18px 60px #020917b8",
  "--theme-surface": "#10223794",
  "--theme-chrome": "#13283e8c",
  "--theme-wallpaper-overlay": "linear-gradient(155deg, #09172870, #080f20c2)",
  "--theme-wallpaper-fallback":
    "radial-gradient(ellipse at 5% 5%, #527caa, transparent 58%), radial-gradient(ellipse at 93% 24%, #365e82, transparent 57%), radial-gradient(ellipse at 56% 105%, #4b668c, transparent 61%)",
} as const;

const lockedHues = new Set(["--err", "--warn", "--run"]);

function remapCss(value: string, deltaHue: number) {
  return value.replace(/#(?:[0-9a-f]{6}|[0-9a-f]{8})\b/gi, (hex) => shiftHexHue(hex, deltaHue));
}

export function frozenGlassPalette(
  seedId: string = frozenGlassSeeds[0].id,
): Record<string, string> {
  const seed = frozenGlassSeeds.find((option) => option.id === seedId) ?? frozenGlassSeeds[0];
  if (seed.id === frozenGlassSeeds[0].id) return { ...template };
  const deltaHue = hctFromHex(seed.color).h - iceHue;
  return Object.fromEntries(
    Object.entries(template).map(([name, value]) => [
      name,
      lockedHues.has(name) ? value : remapCss(value, deltaHue),
    ]),
  );
}

export function frozenGlassStyle(saved?: ThemeValues): Record<string, string> {
  const values = resolveThemeValues(frozenGlass.settings, saved);
  return frozenGlassPalette(String(values.seed));
}

export const frozenGlass = {
  id: "frozen-glass",
  title: "Frozen Glass",
  description: "Холодная палитра, полупрозрачные панели и настраиваемый фон.",
  mode: "dark",
  themeColor: "#172a3f",
  settings: [
    {
      id: "seed",
      kind: "seed",
      title: "Опорный цвет",
      hint: "Палитра строится от выбранного холодного тона в модели HCT.",
      default: frozenGlassSeeds[0].id,
      options: frozenGlassSeeds,
    },
    {
      id: "backgroundUrl",
      kind: "wallpaper",
      title: "Фоновое изображение",
      hint: "Изображение по ссылке будет скачано и сохранено на диске. Пустое поле возвращает градиент.",
      default: "",
    },
    {
      id: "blur",
      kind: "blur",
      title: "Размытие панелей",
      default: 18,
      min: 0,
      max: 40,
    },
  ] as const satisfies readonly ThemeSetting[],
  legacySettingsKey: "frozenGlass",
} as const;
