import type { ThemeSetting } from "../plugins/index.ts";

export const frozenGlass = {
  id: "frozen-glass",
  title: "Frozen Glass",
  description: "Холодная палитра, полупрозрачные панели и настраиваемый фон.",
  mode: "dark",
  themeColor: "#172a3f",
  settings: [
    {
      id: "backgroundUrl",
      kind: "wallpaper",
      title: "Фоновое изображение",
      hint: "Вставьте ссылку на изображение. Пустое поле возвращает градиент.",
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
