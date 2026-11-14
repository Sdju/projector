import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import type { AgentBackendId } from "./backend.ts";
import { runsChanged } from "./change-events.ts";

/** Finished chat runs are kept this long so the notification panel shows what completed. */
export const RECENT_RUN_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_RUN_LIMIT = 100;

export interface RecentRun {
  id: string;
  backend: AgentBackendId;
  projectId: string;
  chat: string;
  topic: string;
  status: "done" | "error" | "stopped";
  error?: string;
  resultPreview?: string;
  /** The assistant ended with an interactive form and waits for the user's reply. */
  awaitingReply?: boolean;
  session?: string;
  startedAt: number;
  endedAt: number;
}

const host = globalThis as typeof globalThis & {
  projectorRecentRuns?: Map<string, RecentRun[]>;
};
const stores = (host.projectorRecentRuns ??= new Map<string, RecentRun[]>());
const locks = new Map<string, Promise<void>>();

const recentRunsPath = () => join(dataDir(), "agent", "recent-runs.json");

function serialized<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  locks.set(path, tail);
  void tail.then(() => {
    if (locks.get(path) === tail) locks.delete(path);
  });
  return next;
}

async function loadFromDisk(path: string): Promise<RecentRun[]> {
  const cached = stores.get(path);
  if (cached) return cached;
  let list: RecentRun[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (item): item is RecentRun =>
          !!item &&
          typeof item === "object" &&
          typeof (item as RecentRun).id === "string" &&
          typeof (item as RecentRun).backend === "string" &&
          typeof (item as RecentRun).endedAt === "number",
      );
    }
  } catch {
    // Missing or unreadable file starts fresh.
  }
  stores.set(path, list);
  return list;
}

async function saveToDisk(path: string, list: RecentRun[]): Promise<void> {
  stores.set(path, list);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(list), { mode: 0o600 });
  await rename(temp, path);
}

function prune(list: RecentRun[], now = Date.now()): RecentRun[] {
  return list
    .filter((item) => now - item.endedAt < RECENT_RUN_TTL_MS)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, RECENT_RUN_LIMIT);
}

/**
 * Whether an answer ends with an interactive Projector form (`<IntelligentForm>` / `<Form>`),
 * meaning the agent explicitly requested structured input from the user.
 */
export function hasAnswerForm(text: string): boolean {
  const stripped = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*$/gi, "").trim();
  if (!stripped) return false;
  if (
    /(?:<\/IntelligentForm>|<\/Form>|<IntelligentForm\b[^>]*\/>|<Form\b[^>]*\/>)\s*$/i.test(
      stripped,
    )
  )
    return true;
  if (/<\/Card>\s*$/i.test(stripped)) {
    const openCard = stripped.lastIndexOf("<Card");
    if (openCard >= 0) {
      const card = stripped.slice(openCard);
      return /<(?:IntelligentForm|Form)\b/i.test(card);
    }
  }
  return false;
}

/** Records a finished chat run so the notification center and bell surface completions. */
export async function recordRecentRun(entry: RecentRun): Promise<void> {
  const path = recentRunsPath();
  await serialized(path, async () => {
    const list = await loadFromDisk(path);
    const filtered = list.filter(
      (item) => item.id !== entry.id && (!entry.chat || item.chat !== entry.chat),
    );
    filtered.unshift(entry);
    await saveToDisk(path, prune(filtered));
  });
  runsChanged();
}

/** Drops the previous finished entry for a chat once a new turn starts in that chat. */
export async function clearRecentRunForChat(chat: string): Promise<void> {
  if (!chat) return;
  const path = recentRunsPath();
  await serialized(path, async () => {
    const list = await loadFromDisk(path);
    const filtered = list.filter((item) => item.chat !== chat);
    if (filtered.length === list.length) return;
    await saveToDisk(path, prune(filtered));
  });
}

export async function listRecentRuns(now = Date.now()): Promise<RecentRun[]> {
  const path = recentRunsPath();
  const list = await loadFromDisk(path);
  return prune(list, now);
}
