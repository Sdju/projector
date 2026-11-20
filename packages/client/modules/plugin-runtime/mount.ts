import type { ThemeSettingsContext } from "@ai-projector/plugin-api";
import {
  findPanel,
  findRuntimeAgent,
  findTab,
  keyOf,
  reportIssue,
  type ActiveThemeSettings,
} from "./store.ts";

function runMount<Context>(
  packageName: string,
  mount: (container: HTMLElement, context: Context) => unknown,
  container: HTMLElement,
  context: Context,
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

export function mountThemeSettings(
  entry: ActiveThemeSettings,
  container: HTMLElement,
  context: Omit<ThemeSettingsContext, "assetUrl">,
  onError: (message: string) => void,
): () => void {
  return runMount(
    entry.packageName,
    (element, settingsContext) =>
      Promise.resolve().then(() => {
        if (!settingsContext.signal.aborted) return entry.mount(element, settingsContext);
      }),
    container,
    { ...context, assetUrl: entry.assetUrl },
    onError,
  );
}
