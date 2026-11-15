import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
import {
  isCount,
  isRecord,
  isText,
  optionalField,
  readStateFile,
  type ParsedState,
} from "./state-file.ts";
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

const recentRunsPath = () => join(dataDir(), "agent", "recent-runs.json");

async function loadFromDisk(path: string): Promise<RecentRun[]> {
  const cached = stores.get(path);
  if (cached) return cached;
  const read = await readStateFile(path, "Список недавних запусков", parseRecentRuns);
  const list = read.status === "ok" ? read.value : [];
  stores.set(path, list);
  return list;
}

/** Негодную запись в списке недавних запусков безопасно выбросить: список только для панели. */
function parseRecentRuns(value: unknown): ParsedState<RecentRun[]> | undefined {
  if (!Array.isArray(value)) return;
  const runs = value.filter(isRecentRun);
  return { value: runs, dropped: value.length - runs.length };
}

const RECENT_STATUSES = new Set(["done", "error", "stopped"]);
function isRecentRun(value: unknown): value is RecentRun {
  if (!isRecord(value)) return false;
  if (!isText(value.id) || !isText(value.backend)) return false;
  if (!isText(value.projectId) || !isText(value.chat) || !isText(value.topic)) return false;
  if (!RECENT_STATUSES.has(value.status as string)) return false;
  if (!isCount(value.startedAt) || !isCount(value.endedAt)) return false;
  for (const key of ["error", "resultPreview", "session"])
    if (!optionalField(value, key, isText)) return false;
  return optionalField(value, "awaitingReply", (item) => typeof item === "boolean");
}

async function saveToDisk(path: string, list: RecentRun[]): Promise<void> {
  stores.set(path, list);
  // Каталог недавних запусков закрыт от остальных пользователей, как и сам файл.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path, JSON.stringify(list));
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
  await withFileLock(path, async () => {
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
  await withFileLock(path, async () => {
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
