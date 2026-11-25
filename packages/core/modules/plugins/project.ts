import { pluginPackageKey, pluginPackageName } from "./asset.ts";

/**
 * Project plugins share the manifest format with user plugins but never their identity: the
 * catalog id carries the project, so a package with the same name in two projects (or next to a
 * user plugin) keeps separate commands, assets, storage and agent ids.
 */
const projectPrefix = "project:";

export interface ProjectPluginRef {
  projectId: string;
  packageName: string;
}

/** `project:<base64url(projectId)>:<packageName>`; the project id may contain `:` and `/`. */
export function projectPluginId(projectId: string, packageName: string): string {
  if (!projectId) throw new Error("Не указан проект для плагина");
  if (!packageName) throw new Error("Не указано имя плагина");
  return `${projectPrefix}${pluginPackageKey(projectId)}:${packageName}`;
}

/** The project and package behind a scoped plugin id, or `null` for a user plugin id. */
export function parseProjectPluginId(value: string): ProjectPluginRef | null {
  if (!value.startsWith(projectPrefix)) return null;
  const rest = value.slice(projectPrefix.length);
  const separator = rest.indexOf(":");
  if (separator < 1) return null;
  const projectId = pluginPackageName(rest.slice(0, separator));
  const packageName = rest.slice(separator + 1);
  if (!projectId || !packageName) return null;
  return { projectId, packageName };
}

export function isProjectPluginId(value: string): boolean {
  return parseProjectPluginId(value) !== null;
}

/**
 * Where a package's own HTTP routes live. User packages keep `/api/plugins/<key>/`; a project
 * package is addressed under its project, so two projects cannot answer the same webhook path.
 */
export function pluginBasePath(packageName: string): string {
  const project = parseProjectPluginId(packageName);
  if (!project) return `/api/plugins/${pluginPackageKey(packageName)}`;
  return `/api/projects/${pluginPackageKey(project.projectId)}/plugins/${pluginPackageKey(packageName)}`;
}

/** A concrete package route; the server matches the declared pattern under the same base. */
export function pluginHttpUrl(packageName: string, path: string): string {
  return `${pluginBasePath(packageName)}/${path.replace(/^\/+/, "")}`;
}
