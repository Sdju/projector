import { hasLiveSession } from "../../agent/index.ts";
import type { AgentBackendId } from "../../agent/index.ts";
import { acpProgram } from "./acp-programs.ts";

const host = globalThis as typeof globalThis & { projectorAcpSessionOwners?: Set<string> };
const owners = (host.projectorAcpSessionOwners ??= new Set<string>());

/** Reserve before launching ACP, including concurrent requests that do not yet have a host PID. */
export async function reserveAcpSession(
  id: AgentBackendId,
  session?: string,
  run?: string,
): Promise<() => void> {
  if (!session || !acpProgram(id).exclusiveSession) return () => {};
  const key = JSON.stringify([id, session]);
  const busy = () => new Error("Сессия агента занята. Дождитесь окончания текущего хода.");
  if (owners.has(key)) throw busy();
  owners.add(key);
  try {
    if (await hasLiveSession(id, session, run)) throw busy();
    return () => owners.delete(key);
  } catch (error) {
    owners.delete(key);
    throw error;
  }
}
