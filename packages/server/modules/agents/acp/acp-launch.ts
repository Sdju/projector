import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  parseAgentLaunchOverride,
  type AgentLaunchOverride,
  type AgentLaunchPlan,
  type AgentLaunchSettingsView,
  type AgentLaunchState,
} from "@ai-projector/core/modules/agent-launch/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { writeFileAtomic, withFileLock } from "../../atomic-files/index.ts";
import { isAgentBackend, type AgentBackendId } from "../../agent/index.ts";
import { acpProgram, acpPrograms, hasAcpProgram, type AcpProgram } from "./acp-programs.ts";

/** Where this machine's ACP launch overrides live. */
export const acpLaunchFile = () => join(dataDir(), "agent", "launch.json");

interface Stored {
  version: 1;
  agents: Record<string, AgentLaunchOverride>;
}

const empty = (): Stored => ({ version: 1, agents: {} });

let cache: { key: string; value: Stored } | undefined;
let revision = 0;

/** Monotonic version plus the file stamp so tool caches drop on both API and manual edits. */
export function acpLaunchRevision(): string {
  return `${revision}:${keyOf(acpLaunchFile()) ?? ""}`;
}

function keyOf(file: string): string | undefined {
  try {
    const stat = statSync(file);
    return `${file}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    return undefined;
  }
}

/**
 * The settings are tiny, and `available()` is synchronous: the file is read once per change and
 * cached by its mtime/size. A manual edit is picked up without restarting the server. An id that
 * is not registered yet is kept, so a plugin agent finds its override when it joins the registry.
 */
function readStateSync(): Stored {
  const file = acpLaunchFile();
  const key = keyOf(file);
  if (!key) return empty();
  if (cache?.key === key) return cache.value;
  let value = empty();
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { agents?: unknown };
    const agents: Record<string, AgentLaunchOverride> = {};
    if (data && typeof data === "object" && data.agents && typeof data.agents === "object")
      for (const [id, raw] of Object.entries(data.agents)) {
        if (id === "__proto__" || id === "constructor" || id === "prototype") continue;
        try {
          const override = parseAgentLaunchOverride(raw);
          if (override) agents[id] = override;
        } catch {
          // One damaged entry must not discard the other agents' launch settings.
        }
      }
    value = { version: 1, agents };
  } catch {
    // A missing or unreadable file means "use every descriptor as is".
  }
  cache = { key, value };
  return value;
}

/** The saved override of one backend, if any. */
export function launchOverride(id: AgentBackendId): AgentLaunchOverride | undefined {
  return readStateSync().agents[id];
}

function writeState(state: Stored): Promise<void> {
  return writeFileAtomic(acpLaunchFile(), `${JSON.stringify(state, null, 2)}\n`, {
    ownerOnly: true,
  });
}

function executableName(command: string): string {
  return (command.replace(/\\/g, "/").split("/").pop() ?? "")
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

/**
 * Base arguments for a custom command: the preferred binary's own arguments when it names that
 * binary, otherwise the descriptor's arguments. A custom command alone therefore keeps the
 * agent's protocol mode (`acp`) instead of silently starting the CLI without it.
 */
export function defaultArgsForCommand(program: AcpProgram, command: string): string[] {
  if (program.binary && executableName(program.binary) === executableName(command))
    return [...(program.binaryArgs ?? [])];
  return [...program.args];
}

/**
 * A descriptor's command as it would run without an override. A preferred binary only counts if
 * it is installed; `exists` lets the caller resolve it through the agent's own PATH.
 */
export function resolveAcpLaunch(
  program: AcpProgram,
  override: AgentLaunchOverride | undefined,
  exists: (command: string) => boolean,
): AgentLaunchPlan {
  if (override?.command)
    return {
      command: override.command,
      args: [...(override.args ?? defaultArgsForCommand(program, override.command))],
      source: "override",
    };
  const binary = program.binary && exists(program.binary);
  const command = binary ? program.binary! : program.command;
  const args = override?.args ?? (binary ? (program.binaryArgs ?? []) : program.args);
  return { command, args: [...args], source: binary ? "binary" : "default" };
}

/** `npx` must run outside the project, or a project's package manager blocks it. */
export function isNpxCommand(command: string): boolean {
  const base = command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return base === "npx" || base === "npx.cmd" || base === "npx.exe" || base === "npx.ps1";
}

/** Merges `overrideEnv` into `base`, replacing case-variant duplicates on Windows (e.g. `Path`/`PATH`). */
export function mergeLaunchEnv(
  base: Record<string, string | undefined>,
  overrideEnv: Record<string, string> | undefined,
): Record<string, string | undefined> {
  if (!overrideEnv) return base;
  const merged: Record<string, string | undefined> = { ...base };
  if (process.platform === "win32") {
    const replacements = new Map<string, string>();
    for (const key of Object.keys(overrideEnv)) replacements.set(key.toUpperCase(), key);
    for (const existing of Object.keys(merged)) {
      const next = replacements.get(existing.toUpperCase());
      if (next && next !== existing) delete merged[existing];
    }
  }
  for (const [key, value] of Object.entries(overrideEnv)) merged[key] = value;
  return merged;
}

/** The environment an override adds to: the server's own is enough for a synchronous check. */
function launchEnvironment(
  override: AgentLaunchOverride | undefined,
): Record<string, string | undefined> {
  return mergeLaunchEnv(process.env, override?.env);
}

function isAbsoluteExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * An absolute path is checked directly: a user-supplied `PATH` may be so narrow that even
 * `which`/`where` cannot be found, while the executable itself is present.
 */
export function acpCommandExists(
  command: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (isAbsolute(command)) return isAbsoluteExecutable(command);
  return os.tools.commandExists(command, env);
}

function acpCommandPath(
  command: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (isAbsolute(command)) return isAbsoluteExecutable(command) ? resolve(command) : undefined;
  return os.tools.commandPath(command, env);
}

/** The executable a TUI session starts: the override wins over the descriptor's terminal. */
export function acpTerminalExecutable(id: AgentBackendId, fallback: string): string {
  return launchOverride(id)?.command ?? fallback;
}

/** Whether the command this machine will actually start can be found. */
export function acpLaunchAvailable(id: AgentBackendId): boolean {
  const override = launchOverride(id);
  const env = launchEnvironment(override);
  const launch = resolveAcpLaunch(acpProgram(id), override, (command) =>
    acpCommandExists(command, env),
  );
  return acpCommandExists(launch.command, env);
}

/** What the settings, the chat menu and the status checks read. */
export function acpLaunchSettings(): AgentLaunchSettingsView {
  const defaultExistsCache = new Map<string, boolean>();
  const defaultExists = (command: string) => {
    const cached = defaultExistsCache.get(command);
    if (cached !== undefined) return cached;
    const ok = acpCommandExists(command);
    defaultExistsCache.set(command, ok);
    return ok;
  };
  const agents: AgentLaunchState[] = acpPrograms()
    .filter((program) => isAgentBackend(program.id))
    .map((program) => {
      const override = launchOverride(program.id);
      const defaultPlan = resolveAcpLaunch(program, undefined, defaultExists);
      const env = launchEnvironment(override);
      const exists = override?.env
        ? (command: string) => acpCommandExists(command, env)
        : defaultExists;
      const effective = resolveAcpLaunch(program, override, exists);
      const found = exists(effective.command);
      const path = found ? acpCommandPath(effective.command, env) : undefined;
      return {
        id: program.id,
        label: program.label,
        default: defaultPlan,
        ...(override ? { override } : {}),
        effective: { ...effective, found, ...(path ? { path } : {}) },
      };
    });
  return { file: acpLaunchFile(), agents };
}

/** Saves one machine-local override; an empty value returns the agent to its descriptor. */
export async function setAcpLaunchOverride(
  id: AgentBackendId,
  value: unknown,
): Promise<AgentLaunchSettingsView> {
  if (!hasAcpProgram(id) || !isAgentBackend(id)) throw new Error(`Неизвестный ACP-агент: ${id}`);
  const override = parseAgentLaunchOverride(value);
  await withFileLock(acpLaunchFile(), async () => {
    const state = readStateSync();
    const agents = { ...state.agents };
    if (override) agents[id] = override;
    else delete agents[id];
    await writeState({ version: 1, agents });
  });
  cache = undefined;
  revision++;
  return acpLaunchSettings();
}

/** Removes the override of one backend. */
export function resetAcpLaunchOverride(id: AgentBackendId): Promise<AgentLaunchSettingsView> {
  return setAcpLaunchOverride(id, undefined);
}
