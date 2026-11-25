import { PLUGIN_API_VERSION, type DisposableLike } from "@ai-projector/plugin-api";
import { pluginAssetPath } from "@ai-projector/core/modules/plugins/index.ts";
import { deviceBase, deviceUrl } from "../../common/utilities/device-url.ts";
import { clearPluginIssues, reportIssue } from "./store.ts";
import { fetchRuntimeCatalog, type RuntimeCatalog, type RuntimePluginInfo } from "./catalog.ts";
import { createApi } from "./api.ts";
import { createScope, messageOf, trackResult, type Scope } from "./scope.ts";
interface Activation {
  identity: string;
  scope: Scope;
  pending: Promise<void>;
}
const active = new Map<string, Activation>();
const failed = new Set<string>();
let disposed = false;
let projectId = "";
let requestRevision = 0;
let request: AbortController | undefined;

/** The project whose packages are currently active; empty outside a project workspace. */
export function currentPluginProject(): string {
  return projectId;
}

/**
 * Switches the project scope of the runtime. User plugins stay active; packages of the previous
 * project are deactivated on the next snapshot, so their panels, languages and agents disappear.
 */
export async function setPluginProject(value: string): Promise<void> {
  const next = value.trim();
  if (next === projectId) return;
  projectId = next;
  await refreshPluginRuntime();
}

function identityOf(plugin: RuntimePluginInfo): string {
  return [
    deviceBase(),
    plugin.projectId ?? "",
    plugin.id,
    plugin.version ?? "",
    plugin.hash ?? "",
    plugin.browser?.entry ?? "",
    plugin.browser?.hash ?? "",
    String(PLUGIN_API_VERSION),
  ].join("\0");
}

function eligible(plugin: RuntimePluginInfo): boolean {
  return (
    (!plugin.projectId || plugin.projectId === projectId) &&
    plugin.status === "enabled" &&
    plugin.enabled &&
    plugin.trusted &&
    !!plugin.browser &&
    !!plugin.hash &&
    plugin.browser.hash === plugin.hash &&
    plugin.diagnostics.length === 0
  );
}

// Only the authenticated, enabled catalog builds this URL; relative ESM chunks retain device/hash.
// oxlint-disable-next-line feod-structure/layer-imports -- The versioned plugin entry is intentionally resolved at runtime.
const importModule = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

async function activate(plugin: RuntimePluginInfo, activation: Activation): Promise<void> {
  const { scope, identity } = activation;
  clearPluginIssues(plugin.id);
  let phase: "load" | "activate" = "load";
  try {
    const entry = new URL(
      deviceUrl(
        pluginAssetPath(plugin.id, plugin.browser!.hash, plugin.browser!.entry.split("/").at(-1)!),
      ),
      globalThis.location?.origin ?? "http://localhost",
    ).href;
    const imported = (await importModule(entry)) as { default?: unknown; plugin?: unknown };
    if (scope.disposed) return;
    const candidate = (imported.default ?? imported.plugin) as
      | { apiVersion?: unknown; activate?: unknown }
      | undefined;
    if (!candidate || candidate.apiVersion !== PLUGIN_API_VERSION)
      throw new Error("Плагин собран для другой версии API");
    if (typeof candidate.activate !== "function") throw new Error("У плагина нет activate(api)");
    phase = "activate";
    const result = await candidate.activate(createApi(plugin, scope));
    // A cancelled activation still owns its eventual result and disposes it immediately.
    trackResult(scope, result as DisposableLike);
  } catch (error) {
    if (scope.disposed) return;
    scope.dispose();
    if (active.get(plugin.id) === activation) active.delete(plugin.id);
    failed.add(identity);
    reportIssue({
      plugin: plugin.id,
      phase,
      message: messageOf(error, "Не удалось активировать плагин"),
    });
  }
}
function deactivate(packageName: string): void {
  const current = active.get(packageName);
  if (!current) return;
  active.delete(packageName);
  clearPluginIssues(packageName);
  current.scope.dispose();
}
function reconcile(catalog: RuntimeCatalog): Promise<void> {
  if (disposed) return Promise.resolve();
  const desired = new Map(catalog.plugins.filter(eligible).map((plugin) => [plugin.id, plugin]));
  const identities = new Set([...desired.values()].map(identityOf));
  for (const [id, activation] of active) {
    const plugin = desired.get(id);
    if (!plugin || activation.identity !== identityOf(plugin)) deactivate(id);
  }
  for (const identity of failed) if (!identities.has(identity)) failed.delete(identity);
  const pending: Promise<void>[] = [];
  for (const plugin of desired.values()) {
    const identity = identityOf(plugin);
    if (failed.has(identity)) continue;
    let activation = active.get(plugin.id);
    if (!activation) {
      activation = { identity, scope: createScope(plugin.id), pending: Promise.resolve() };
      active.set(plugin.id, activation);
      activation.pending = activate(plugin, activation);
    }
    pending.push(activation.pending);
  }
  return Promise.all(pending).then(() => {});
}
/** New snapshots immediately cancel obsolete scopes, including activations still awaiting a result. */
export function applyRuntimeCatalog(catalog: RuntimeCatalog): Promise<void> {
  requestRevision++;
  request?.abort();
  return reconcile(catalog);
}
export async function refreshPluginRuntime(): Promise<void> {
  const revision = ++requestRevision;
  request?.abort();
  const controller = (request = new AbortController());
  const requestedProject = projectId;
  try {
    const catalog = await fetchRuntimeCatalog(requestedProject, controller.signal);
    if (disposed || revision !== requestRevision) return;
    failed.clear();
    await reconcile(catalog);
  } catch (error) {
    if (controller.signal.aborted || revision !== requestRevision) return;
    reportIssue({
      plugin: "plugin-runtime",
      phase: "load",
      message: messageOf(error, "Не удалось загрузить каталог плагинов"),
    });
  }
}
export function disposePluginRuntime(): void {
  disposed = true;
  projectId = "";
  requestRevision++;
  request?.abort();
  for (const id of active.keys()) deactivate(id);
  failed.clear();
  if (typeof window !== "undefined") window.removeEventListener("pagehide", disposePluginRuntime);
}
export function initPluginRuntime(): Promise<void> {
  disposed = false;
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", disposePluginRuntime, { once: true });
  return refreshPluginRuntime();
}
