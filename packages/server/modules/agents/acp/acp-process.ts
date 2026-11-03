import { agentEnv, assertHostProject, attachHosted, startHosted } from "../../agent/index.ts";
import type { AgentBackendId, AgentRunHandle } from "../../agent/index.ts";
import { os } from "@projector/core/modules/os/index.ts";
import {
  createAcpConnection,
  type AcpConnection,
  type AcpConnectionHandlers,
} from "./acp-client.ts";
import { acpProgram, type AcpProgram } from "./acp-programs.ts";

/** Agent Client Protocol revision this client speaks. */
const PROTOCOL_VERSION = 1;

export interface AcpInitResult {
  authMethods?: { id?: string }[];
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: Record<string, unknown>;
    /** What a prompt may contain besides text and links. */
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    /** Which kinds of MCP server the agent can be given besides stdio ones. */
    mcpCapabilities?: { http?: boolean; sse?: boolean };
  };
}

/**
 * Prefer a globally installed binary. `npx` reads the working directory's `package.json`, so a
 * project that pins another package manager (`devEngines`/`packageManager`) makes npm refuse to
 * start; the `npx` fallback therefore runs outside the project. The session still gets the project
 * through `session/new`, so the agent's own config and files are unaffected.
 */
async function resolveLaunch(program: AcpProgram, cwd: string) {
  // Resolve programs the way a terminal session does, not through the server's own PATH.
  const env = await os.tools.agentEnv(agentEnv());
  if (program.binary && os.tools.commandExists(program.binary, env))
    return { command: program.binary, args: [] as string[], cwd, env };
  if (program.command === "npx")
    return { command: program.command, args: program.args, cwd: os.dataHome(), env };
  return { command: program.command, args: program.args, cwd, env };
}

/**
 * Spawns the agent's ACP server for `cwd` and wraps it in a connection; nothing is sent yet.
 * With a `run` the process is held by a host that outlives this server (see `hosted-process.ts`)
 * and may be an earlier server's run that is rejoined; without one it is a plain child process.
 */
export async function startAcp(
  id: AgentBackendId,
  cwd: string | undefined,
  handlers: Omit<AcpConnectionHandlers, "label">,
  run?: AgentRunHandle,
): Promise<AcpConnection> {
  const program = acpProgram(id);
  if (!cwd) throw new Error(`${program.label} работает внутри проекта: откройте чат в проекте`);
  await assertHostProject(cwd, program.label);
  const child = run?.attach
    ? await attachHosted(run.id)
    : run
      ? await startHosted(run.id, await resolveLaunch(program, cwd))
      : os.tools.spawnAgentProcess(await resolveLaunch(program, cwd));
  return createAcpConnection(child, { ...handlers, label: program.label });
}

/** What the last handshake said about `session/delete`, so the UI does not offer a dead action. */
const advertisedDelete = new Map<AgentBackendId, boolean>();

export function acpAdvertisedDelete(id: AgentBackendId): boolean {
  return advertisedDelete.get(id) === true;
}

/** Nested objects of `clientCapabilities` are merged one level; scalars replace. */
export function mergeClientCapabilities(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extra) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    )
      out[key] = { ...(prev as Record<string, unknown>), ...(value as Record<string, unknown>) };
    else out[key] = value;
  }
  return out;
}

export async function initializeAcp(
  connection: AcpConnection,
  id?: AgentBackendId,
): Promise<AcpInitResult> {
  const extra = id ? acpProgram(id).clientCapabilities : undefined;
  const init = (await connection.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: mergeClientCapabilities(
      {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        // Agents ask their questions through forms; without this they answer for the user.
        elicitation: { form: {} },
      },
      extra,
    ),
    clientInfo: { name: "projector", title: "Projector", version: "1.0" },
  })) as AcpInitResult;
  if (id) advertisedDelete.set(id, !!init.agentCapabilities?.sessionCapabilities?.delete);
  return init;
}
