import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { Project } from "../../../core/modules/project/index.ts";
import { trustedDevcontainer } from "./state.ts";

const SCRIPT = [
  'node="$1"; cli="$2"; workspace="$3"; config="$4"; shift 4',
  // Progress of the build goes to the terminal on stderr; stdout carries only the JSON result.
  '"$node" "$cli" up --workspace-folder "$workspace" --config "$config" >/dev/null || { echo "devcontainer up завершился с ошибкой" >&2; exit 1; }',
  'exec "$node" "$cli" exec --workspace-folder "$workspace" --config "$config" "$@"',
].join("\n");

/**
 * Runs `command` inside the project's dev container, building it first when needed.
 * Only for configs the user trusted in their current form; undefined otherwise.
 */
/** Where the CLI mounts the project: `workspaceFolder`, else `/workspaces/<folder name>`. */
export function containerWorkspace(config: Record<string, unknown>, root: string) {
  const name = basename(root);
  const custom = config.workspaceFolder;
  if (typeof custom === "string" && custom.startsWith("/"))
    return custom.replaceAll("${localWorkspaceFolderBasename}", name).replace(/\/+$/, "");
  return `/workspaces/${name}`;
}

export function devcontainerLaunch(project: Project, command: string[]) {
  const config = trustedDevcontainer(project);
  if (!config) return undefined;
  const cli = createRequire(import.meta.url).resolve("@devcontainers/cli/devcontainer.js");
  return {
    file: "/bin/sh",
    args: [
      "-c",
      SCRIPT,
      "projector-devcontainer",
      process.execPath,
      cli,
      realpathSync(project.path),
      config.file,
      ...command,
    ],
    title: `Dev Container · ${project.name}`,
    workspace: containerWorkspace(config.config, realpathSync(project.path)),
  };
}
