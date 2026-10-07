import { os } from "../../../core/modules/os/index.ts";
import {
  createAcpConnection,
  type AcpConnection,
  type AcpConnectionHandlers,
} from "./acp-client.ts";
import { ACP_PROGRAMS, type AcpProgram } from "./acp-programs.ts";
import { agentEnv, assertHostProject } from "./agent-host.ts";
import type { AgentBackendId } from "./backend.ts";

/** Agent Client Protocol revision this client speaks. */
const PROTOCOL_VERSION = 1;

export interface AcpInitResult {
  authMethods?: { id?: string }[];
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: Record<string, unknown>;
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

export function acpProgram(id: AgentBackendId): AcpProgram {
  const program = ACP_PROGRAMS[id];
  if (!program) throw new Error(`Неизвестный ACP-агент: ${id}`);
  return program;
}

/** Spawns the agent's ACP server for `cwd` and wraps it in a connection; nothing is sent yet. */
export async function startAcp(
  id: AgentBackendId,
  cwd: string | undefined,
  handlers: Omit<AcpConnectionHandlers, "label">,
): Promise<AcpConnection> {
  const program = acpProgram(id);
  if (!cwd) throw new Error(`${program.label} работает внутри проекта: откройте чат в проекте`);
  await assertHostProject(cwd, program.label);
  const child = os.tools.spawnAgentProcess(await resolveLaunch(program, cwd));
  return createAcpConnection(child, { ...handlers, label: program.label });
}

export async function initializeAcp(connection: AcpConnection): Promise<AcpInitResult> {
  return (await connection.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "projector", title: "Projector", version: "1.0" },
  })) as AcpInitResult;
}
