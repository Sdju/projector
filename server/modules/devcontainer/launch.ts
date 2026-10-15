import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { Project } from "../../../core/modules/project/index.ts";
import { os, bashShellLaunch, type ShellLaunch } from "../../../core/modules/os/index.ts";
import { trustedDevcontainer } from "./state.ts";

const SCRIPT = `
const { spawnSync } = require("node:child_process");
const [cli, workspace, config, ...command] = process.argv.slice(1);
const options = ["--workspace-folder", workspace, "--config", config];
const up = spawnSync(process.execPath, [cli, "up", ...options], { stdio: ["inherit", "ignore", "inherit"] });
if (up.error || up.status !== 0) {
  console.error(up.error?.message || "devcontainer up завершился с ошибкой");
  process.exit(up.status || 1);
}
const result = spawnSync(process.execPath, [cli, "exec", ...options, ...command], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
`;

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

export function devcontainerLaunch(project: Project, shell: ShellLaunch) {
  const config = trustedDevcontainer(project);
  if (!config) return undefined;
  const cli = createRequire(import.meta.url).resolve("@devcontainers/cli/devcontainer.js");
  const command = bashShellLaunch(shell);
  return {
    ...os.tools.ptyCommand(process.execPath, [
      "--input-type=commonjs",
      "-e",
      SCRIPT,
      cli,
      realpathSync(project.path),
      config.file,
      command.file,
      ...command.args,
    ]),
    title: `Dev Container · ${project.name}`,
    workspace: containerWorkspace(config.config, realpathSync(project.path)),
  };
}
