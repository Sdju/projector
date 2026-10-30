import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import type { AgentCommandCall } from "../../../core/modules/ide/index.ts";
import { broadcastEvent, onEventClientClose } from "../events/index.ts";

interface Pending {
  id: string;
  session: string;
  projectId: string;
  request: AgentCommandCall;
  expiresAt: number;
  /** A page that does not own the MCP session may take over after this moment. */
  fallbackAt: number;
  owner?: string;
  claimedBy?: string;
  finish: (result: { output?: unknown; error?: string }) => void;
}

const host = globalThis as typeof globalThis & {
  projectorIdeBridge?: {
    pending: Map<string, Pending>;
    /** MCP session → the page that answered it; later calls of the session go there first. */
    owners: Map<string, string>;
    token?: string;
    off?: () => void;
  };
};
const state = (host.projectorIdeBridge ??= {
  pending: new Map<string, Pending>(),
  owners: new Map<string, string>(),
});
// A hot reload keeps the old object: fill fields added by a newer version instead of crashing.
if (!state.pending) state.pending = new Map<string, Pending>();
if (!state.owners) state.owners = new Map<string, string>();

/** How long the owner page has to take a request before another tab of the project may. */
const OWNER_GRACE_MS = 3000;

/** The key of the built-in IDE MCP server: only its holder may ask the page for commands. */
export const ideMcpTokenFile = () => join(dataDir(), "agent", "ide-mcp.token");

/** Reads the key, creating it once so a restarted server keeps the key an older MCP process holds. */
export async function ensureIdeMcpToken(): Promise<string> {
  if (state.token) return state.token;
  const path = ideMcpTokenFile();
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return (state.token = existing);
  } catch {
    // Missing or unreadable: create a new one below.
  }
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  return (state.token = token);
}

export async function ideMcpTokenMatches(value: string | null | undefined): Promise<boolean> {
  const expected = await ensureIdeMcpToken();
  if (!value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function broadcast(entry: Pending): void {
  const payload = {
    id: entry.id,
    session: entry.session,
    projectId: entry.projectId,
    request: entry.request,
    owner: entry.owner,
    fallbackAt: entry.fallbackAt,
    expiresAt: entry.expiresAt,
  };
  // Every page receives it: the owner answers at once, the others wait for the grace period.
  broadcastEvent("ide-command-request", payload);
}

/**
 * A page that goes away releases its sessions. A request it had not claimed is offered to the
 * other tabs of the project; a request it was already running fails instead of running twice.
 */
state.off?.();
state.off = onEventClientClose((page) => {
  for (const [session, owner] of [...state.owners]) {
    if (owner !== page) continue;
    state.owners.delete(session);
    for (const entry of [...state.pending.values()]) {
      if (entry.session !== session) continue;
      if (entry.claimedBy) entry.finish({ error: "Страница Projector закрыта" });
      else {
        entry.owner = undefined;
        entry.claimedBy = undefined;
        broadcast(entry);
      }
    }
  }
});

/**
 * Asks the page that owns the MCP session for a command. The first answer binds the session to
 * that page, so discovery and execution see the same workbench; another tab may take over only
 * after a short grace period or when the owner page closes.
 */
export function requestIdeCommand(
  projectId: string,
  session: string,
  request: AgentCommandCall,
  timeoutMs = 60_000,
): Promise<unknown> {
  const id = randomUUID();
  const now = Date.now();
  const owner = state.owners.get(session);
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const entry: Pending = {
      id,
      session,
      projectId,
      request,
      expiresAt: now + timeoutMs,
      fallbackAt: now + Math.min(OWNER_GRACE_MS, Math.floor(timeoutMs / 2)),
      ...(owner ? { owner } : {}),
      finish: (result) => {
        if (!state.pending.delete(id)) return;
        clearTimeout(timer);
        if (result.error) reject(new Error(result.error));
        else resolve(result.output);
      },
    };
    timer = setTimeout(() => {
      // The page may be waiting on a confirmation: tell it the deadline has passed.
      broadcastEvent("ide-command-cancel", { id }, entry.claimedBy ?? entry.owner);
      entry.finish({ error: "Projector не ответил на запрос команды" });
    }, timeoutMs);
    state.pending.set(id, entry);
    broadcast(entry);
  });
}

/** The owner takes a request at once; another page may take it after the grace period. */
export function claimIdeCommand(id: string, page: string): boolean {
  const entry = state.pending.get(id);
  if (!entry || entry.claimedBy || !page || Date.now() >= entry.expiresAt) return false;
  if (entry.owner && entry.owner !== page && Date.now() < entry.fallbackAt) return false;
  entry.claimedBy = page;
  entry.owner = page;
  state.owners.set(entry.session, page);
  return true;
}

export function completeIdeCommand(
  id: string,
  page: string,
  result: { output?: unknown; error?: string },
): boolean {
  const entry = state.pending.get(id);
  if (!entry || !page || entry.claimedBy !== page) return false;
  entry.finish(result);
  return true;
}
