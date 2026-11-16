import { assertAllowedKeys, assertRecord, assertText } from "./agent.ts";

/**
 * Declarative metadata of browser contributions. The manifest names what a package may register;
 * the runtime contribution must use the same local id. JavaScript is only loaded after trust.
 */

export interface PluginBrowserEntry {
  /** Package-relative ESM entry, for example `dist/browser.js`. */
  entry: string;
  /** base64url key of the package name; part of the asset route. */
  key: string;
}

export interface PluginLanguageContribution {
  id: string;
  title: string;
  description?: string;
  extensions?: string[];
  filenames?: string[];
  /** Higher priority wins when several packages claim the same file. */
  priority?: number;
}

export interface PluginPanelContribution {
  id: string;
  title: string;
  description?: string;
  placement: "sidebar" | "aside";
}

export interface PluginTabContribution {
  id: string;
  title: string;
  description?: string;
}

export interface PluginBrowserContributions {
  languages?: PluginLanguageContribution[];
  panels?: PluginPanelContribution[];
  tabs?: PluginTabContribution[];
}

const idPattern = /^[a-z0-9][a-z0-9._-]*$/;
const extensionPattern = /^\.?[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const filenamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/;
const browserEntryLength = 300;
const maxContributions = 50;
const maxExtensions = 20;

export function assertBrowserEntry(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > browserEntryLength)
    throw new Error(`projector.browser: ожидается непустой путь до ${browserEntryLength} символов`);
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value))
    throw new Error("projector.browser: путь должен быть относительным");
  if (value.includes("\\") || value.includes("\0"))
    throw new Error("projector.browser: недопустимые символы в пути");
  if (value.split("/").some((segment) => segment === ".." || segment === "." || !segment))
    throw new Error("projector.browser: недопустимы пустые сегменты и ..");
  if (!value.includes("/"))
    throw new Error("projector.browser: entry должен лежать в каталоге артефактов, например dist/");
  if (!/^[A-Za-z0-9._/-]+\.(?:js|mjs)$/.test(value))
    throw new Error("projector.browser: ожидается ESM-файл .js или .mjs");
}

function assertContributionId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value))
    throw new Error(`Некорректный идентификатор ${label}`);
}

function assertList(value: unknown, label: string, max: number): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} должен быть массивом`);
  if (!value.length) throw new Error(`${label} не должен быть пустым`);
  if (value.length > max) throw new Error(`${label}: не более ${max} элементов`);
}

export function validateLanguageContribution(
  value: unknown,
  ids: Set<string>,
): asserts value is PluginLanguageContribution {
  assertRecord(value, "Язык плагина");
  assertAllowedKeys(
    value,
    ["id", "title", "description", "extensions", "filenames", "priority"],
    "Язык плагина",
  );
  assertContributionId(value.id, "языка");
  if (ids.has(value.id)) throw new Error("Повторяющийся идентификатор языка");
  ids.add(value.id);
  assertText(value.title, "Название языка", 200);
  if (value.description !== undefined) assertText(value.description, "Описание языка", 1000);
  if (value.extensions !== undefined)
    assertList(value.extensions, "extensions языка", maxExtensions);
  if (value.filenames !== undefined) assertList(value.filenames, "filenames языка", maxExtensions);
  if (!value.extensions && !value.filenames)
    throw new Error("Язык должен объявить extensions или filenames");
  for (const extension of (value.extensions as unknown[] | undefined) ?? [])
    if (typeof extension !== "string" || !extensionPattern.test(extension))
      throw new Error("Некорректное расширение языка");
  for (const filename of (value.filenames as unknown[] | undefined) ?? [])
    if (typeof filename !== "string" || !filenamePattern.test(filename))
      throw new Error("Некорректное имя файла языка");
  if (
    value.priority !== undefined &&
    (typeof value.priority !== "number" ||
      !Number.isInteger(value.priority) ||
      value.priority < -1000 ||
      value.priority > 1000)
  )
    throw new Error("priority языка должен быть целым числом от -1000 до 1000");
}

export function validatePanelContribution(
  value: unknown,
  ids: Set<string>,
): asserts value is PluginPanelContribution {
  assertRecord(value, "Панель плагина");
  assertAllowedKeys(value, ["id", "title", "description", "placement"], "Панель плагина");
  assertContributionId(value.id, "панели");
  if (ids.has(value.id)) throw new Error("Повторяющийся идентификатор панели");
  ids.add(value.id);
  assertText(value.title, "Название панели", 200);
  if (value.description !== undefined) assertText(value.description, "Описание панели", 1000);
  if (value.placement !== "sidebar" && value.placement !== "aside")
    throw new Error("placement панели должен быть sidebar или aside");
}

export function validateTabContribution(
  value: unknown,
  ids: Set<string>,
): asserts value is PluginTabContribution {
  assertRecord(value, "Вкладка плагина");
  assertAllowedKeys(value, ["id", "title", "description"], "Вкладка плагина");
  assertContributionId(value.id, "вкладки");
  if (ids.has(value.id)) throw new Error("Повторяющийся идентификатор вкладки");
  ids.add(value.id);
  assertText(value.title, "Название вкладки", 200);
  if (value.description !== undefined) assertText(value.description, "Описание вкладки", 1000);
}

export function validateBrowserContributions(
  contributes: Record<string, unknown>,
): PluginBrowserContributions {
  const languages = contributes.languages as unknown[] | undefined;
  const panels = contributes.panels as unknown[] | undefined;
  const tabs = contributes.tabs as unknown[] | undefined;
  if (languages !== undefined)
    assertList(languages, "projector.contributes.languages", maxContributions);
  if (panels !== undefined) assertList(panels, "projector.contributes.panels", maxContributions);
  if (tabs !== undefined) assertList(tabs, "projector.contributes.tabs", maxContributions);
  if (languages) {
    const ids = new Set<string>();
    for (const language of languages) validateLanguageContribution(language, ids);
  }
  if (panels) {
    const ids = new Set<string>();
    for (const panel of panels) validatePanelContribution(panel, ids);
  }
  if (tabs) {
    const ids = new Set<string>();
    for (const tab of tabs) validateTabContribution(tab, ids);
  }
  return {
    ...(languages ? { languages: languages as PluginLanguageContribution[] } : {}),
    ...(panels ? { panels: panels as PluginPanelContribution[] } : {}),
    ...(tabs ? { tabs: tabs as PluginTabContribution[] } : {}),
  };
}
