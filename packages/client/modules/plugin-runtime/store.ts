import { ref, shallowRef } from "vue";
import { pluginAssetPath, isSafePluginPath } from "@ai-projector/core/modules/plugins/index.ts";
import type {
  PluginLanguageContribution,
  PluginPanelContribution,
  PluginTabContribution,
} from "@ai-projector/core/modules/plugins/index.ts";
import { deviceUrl } from "../../common/utilities/device-url.ts";
import type {
  AgentClientRegistration,
  AgentPlanReader,
  LanguageRule,
  LanguageToken,
} from "@ai-projector/plugin-api";

export interface ActiveLanguage {
  packageName: string;
  declaration: PluginLanguageContribution;
  rules: { regex: RegExp; token?: LanguageToken }[];
  assetUrl(relative: string): string;
}

export interface ActivePanel {
  instance: number;
  key: string;
  packageName: string;
  declaration: PluginPanelContribution;
  mount: (container: HTMLElement, context: unknown) => unknown;
  assetUrl(relative: string): string;
}

export interface ActiveTab {
  instance: number;
  key: string;
  packageName: string;
  declaration: PluginTabContribution;
  mount: (container: HTMLElement, context: unknown) => unknown;
  assetUrl(relative: string): string;
}

export interface ActiveCommand {
  key: string;
  packageName: string;
  id: string;
  title: string;
  description: string;
  arguments?: Record<string, string>;
  run(args?: unknown): unknown;
}

export interface ActiveAgent {
  instance: number;
  key: string;
  packageName: string;
  id: string;
  plan?: AgentPlanReader;
  mountUsage?: AgentClientRegistration["mountUsage"];
  toolLabel?: AgentClientRegistration["toolLabel"];
  assetUrl(relative: string): string;
}

export interface PluginRuntimeIssue {
  plugin: string;
  phase: "load" | "activate" | "contribution" | "cleanup";
  message: string;
}

export const runtimeLanguages = shallowRef<ActiveLanguage[]>([]);
export const runtimePanels = shallowRef<ActivePanel[]>([]);
export const runtimeTabs = shallowRef<ActiveTab[]>([]);
export const runtimeCommands = shallowRef<ActiveCommand[]>([]);
export const runtimeAgents = shallowRef<ActiveAgent[]>([]);
export const runtimeIssues = shallowRef<PluginRuntimeIssue[]>([]);
/** Bumped whenever language contributions change so editors and the status line re-resolve. */
export const languageRevision = ref(0);

const tokenNames = new Set<LanguageToken>([
  "keyword",
  "operatorKeyword",
  "controlKeyword",
  "modifier",
  "operator",
  "punctuation",
  "string",
  "regexp",
  "escape",
  "number",
  "bool",
  "null",
  "atom",
  "comment",
  "typeName",
  "className",
  "namespace",
  "variableName",
  "functionName",
  "propertyName",
  "tagName",
  "angleBracket",
  "attributeName",
  "attributeValue",
  "meta",
  "heading",
  "link",
]);

let nextViewInstance = 0;

const maxRules = 200;
const maxPatternLength = 300;

export function compileLanguageRules(
  rules: LanguageRule[],
  caseInsensitive = false,
): ActiveLanguage["rules"] {
  if (!Array.isArray(rules) || !rules.length || rules.length > maxRules)
    throw new Error(`Язык должен объявить от 1 до ${maxRules} правил`);
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== "object") throw new Error(`Правило ${index}: ожидается объект`);
    if (typeof rule.pattern !== "string" || !rule.pattern || rule.pattern.length > maxPatternLength)
      throw new Error(`Правило ${index}: некорректный pattern`);
    if (rule.token !== undefined && !tokenNames.has(rule.token))
      throw new Error(`Правило ${index}: неизвестный token ${String(rule.token)}`);
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${rule.pattern})`, caseInsensitive ? "iu" : "u");
    } catch {
      throw new Error(`Правило ${index}: pattern не компилируется`);
    }
    if (regex.test("")) throw new Error(`Правило ${index}: pattern совпадает с пустой строкой`);
    return { regex, token: rule.token };
  });
}

function keyOf(packageName: string, id: string): string {
  return `${packageName}\0${id}`;
}

function replace<T>(list: T[], key: (item: T) => string, item: T): T[] {
  return [...list.filter((entry) => key(entry) !== key(item)), item];
}

export function assetUrlFactory(packageName: string, hash: string): (relative: string) => string {
  return (relative) => {
    if (!isSafePluginPath(relative)) throw new Error("Небезопасный путь к ассету плагина");
    return deviceUrl(pluginAssetPath(packageName, hash, relative));
  };
}

export function addLanguage(
  packageName: string,
  declaration: PluginLanguageContribution,
  rules: ActiveLanguage["rules"],
  assetUrl: (relative: string) => string,
): () => void {
  const entry: ActiveLanguage = { packageName, declaration, rules, assetUrl };
  runtimeLanguages.value = replace(
    runtimeLanguages.value,
    (item) => keyOf(item.packageName, item.declaration.id),
    entry,
  );
  languageRevision.value++;
  return () => {
    if (!runtimeLanguages.value.includes(entry)) return;
    runtimeLanguages.value = runtimeLanguages.value.filter((item) => item !== entry);
    languageRevision.value++;
  };
}

export function addPanel(
  packageName: string,
  declaration: PluginPanelContribution,
  mount: ActivePanel["mount"],
  assetUrl: (relative: string) => string,
): () => void {
  const entry: ActivePanel = {
    instance: ++nextViewInstance,
    key: keyOf(packageName, declaration.id),
    packageName,
    declaration,
    mount,
    assetUrl,
  };
  runtimePanels.value = replace(runtimePanels.value, (item) => item.key, entry);
  return () => {
    runtimePanels.value = runtimePanels.value.filter((item) => item !== entry);
  };
}

export function addTab(
  packageName: string,
  declaration: PluginTabContribution,
  mount: ActiveTab["mount"],
  assetUrl: (relative: string) => string,
): () => void {
  const entry: ActiveTab = {
    instance: ++nextViewInstance,
    key: keyOf(packageName, declaration.id),
    packageName,
    declaration,
    mount,
    assetUrl,
  };
  runtimeTabs.value = replace(runtimeTabs.value, (item) => item.key, entry);
  return () => {
    runtimeTabs.value = runtimeTabs.value.filter((item) => item !== entry);
  };
}

export function addCommand(
  packageName: string,
  command: Omit<ActiveCommand, "key" | "packageName">,
): () => void {
  const entry: ActiveCommand = {
    ...command,
    key: keyOf(packageName, command.id),
    packageName,
  };
  runtimeCommands.value = replace(runtimeCommands.value, (item) => item.key, entry);
  return () => {
    runtimeCommands.value = runtimeCommands.value.filter((item) => item !== entry);
  };
}

export function addAgent(
  packageName: string,
  contribution: AgentClientRegistration,
  assetUrl: (relative: string) => string,
): () => void {
  const entry: ActiveAgent = {
    instance: ++nextViewInstance,
    key: keyOf(packageName, contribution.id),
    packageName,
    id: contribution.id,
    ...(contribution.plan ? { plan: contribution.plan } : {}),
    ...(contribution.mountUsage ? { mountUsage: contribution.mountUsage } : {}),
    ...(contribution.toolLabel ? { toolLabel: contribution.toolLabel } : {}),
    assetUrl,
  };
  runtimeAgents.value = replace(runtimeAgents.value, (item) => item.key, entry);
  return () => {
    runtimeAgents.value = runtimeAgents.value.filter((item) => item !== entry);
  };
}

export function reportIssue(issue: PluginRuntimeIssue): void {
  runtimeIssues.value = [...runtimeIssues.value, issue];
}

export function clearPluginIssues(packageName: string): void {
  runtimeIssues.value = runtimeIssues.value.filter((issue) => issue.plugin !== packageName);
}

export function commandIdIsFree(id: string): boolean {
  return !runtimeCommands.value.some((item) => item.id === id);
}

export function findLanguage(path: string): ActiveLanguage | undefined {
  const filename = path.split("/").at(-1)?.toLocaleLowerCase() ?? "";
  return runtimeLanguages.value
    .filter(({ declaration }) => {
      const filenames = (declaration.filenames ?? []).map((value) => value.toLocaleLowerCase());
      if (filenames.includes(filename)) return true;
      const extensions = (declaration.extensions ?? []).map((value) =>
        value.startsWith(".") ? value.toLocaleLowerCase() : `.${value.toLocaleLowerCase()}`,
      );
      return extensions.some((extension) => filename.endsWith(extension));
    })
    .sort(
      (left, right) =>
        (right.declaration.priority ?? 0) - (left.declaration.priority ?? 0) ||
        left.packageName.localeCompare(right.packageName) ||
        left.declaration.id.localeCompare(right.declaration.id),
    )[0];
}

export function findPanel(key: string): ActivePanel | undefined {
  return runtimePanels.value.find((item) => item.key === key);
}

export function findTab(key: string): ActiveTab | undefined {
  return runtimeTabs.value.find((item) => item.key === key);
}

export function findRuntimeAgent(id: string): ActiveAgent | undefined {
  return runtimeAgents.value.find((item) => item.id === id);
}

function runMount(
  packageName: string,
  mount: (container: HTMLElement, context: unknown) => unknown,
  container: HTMLElement,
  context: Record<string, unknown>,
  onError?: (message: string) => void,
): () => void {
  let disposed = false;
  let cleaned = false;
  let settled = false;
  let result: unknown;
  const cleanResult = () => {
    if (cleaned || !settled) return;
    cleaned = true;
    const value = result as { dispose?: () => void } | (() => void) | undefined;
    try {
      if (typeof value === "function") value();
      else value?.dispose?.();
    } catch (error) {
      reportIssue({
        plugin: packageName,
        phase: "cleanup",
        message: error instanceof Error ? error.message : "Ошибка очистки UI плагина",
      });
    }
  };
  const cleanup = () => {
    disposed = true;
    cleanResult();
  };
  Promise.resolve(mount(container, context))
    .then((value) => {
      result = value;
      settled = true;
      if (disposed) cleanResult();
    })
    .catch((error) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : "Ошибка отрисовки UI плагина";
      onError?.(message);
      reportIssue({ plugin: packageName, phase: "activate", message });
    });
  return cleanup;
}

/** Invokes a panel/tab mount and returns a disposer that also tolerates async cleanup. */
export function mountContribution(
  kind: "panel" | "tab",
  packageName: string,
  id: string,
  container: HTMLElement,
  context: Record<string, unknown>,
  onError?: (message: string) => void,
): () => void {
  const entry =
    kind === "panel" ? findPanel(keyOf(packageName, id)) : findTab(keyOf(packageName, id));
  if (!entry) throw new Error("Плагин не зарегистрировал этот вклад");
  return runMount(
    packageName,
    entry.mount,
    container,
    { ...context, assetUrl: entry.assetUrl },
    onError,
  );
}

/** Invokes an agent usage mount and returns a disposer that also tolerates async cleanup. */
export function mountAgentUsage(
  agentId: string,
  container: HTMLElement,
  context: Record<string, unknown>,
  onError?: (message: string) => void,
): () => void {
  const entry = findRuntimeAgent(agentId);
  if (!entry?.mountUsage) throw new Error("Плагин не зарегистрировал индикатор лимитов");
  return runMount(
    entry.packageName,
    entry.mountUsage as never,
    container,
    { ...context, assetUrl: entry.assetUrl },
    onError,
  );
}
