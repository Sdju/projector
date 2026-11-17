import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  isAgentFailure,
  type AgentFailure,
} from "@ai-projector/core/modules/agent-failure/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
import {
  isCount,
  isRecord,
  isStringMap,
  isText,
  optionalField,
  readStateFile,
  type ParsedState,
} from "./state-file.ts";
import type { AgentBackendId, AgentPermissionMode } from "./backend.ts";
import type { AgentSelection } from "./controls.ts";
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
  /** The same failure as data: class, retry advice and the quota reset, when known. */
  failure?: AgentFailure;
  /** Continuation planned by the user: when to send and whether to do it without a page. */
  resume?: { at: number; auto: boolean };
  /** Where the answer ran: a resume repeats the run in the same folder. */
  cwd?: string;
  /** Model controls of the answer, so a resume keeps the same model and effort. */
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  resultPreview?: string;
  /** The assistant ended with an interactive form and waits for the user's reply. */
  awaitingReply?: boolean;
  session?: string;
  startedAt: number;
  endedAt: number;
}

const host = globalThis as typeof globalThis & {
  projectorRecentRuns?: Map<string, RecentRun[]>;
  projectorRecentWrites?: Map<string, Promise<unknown>>;
};
const stores = (host.projectorRecentRuns ??= new Map<string, RecentRun[]>());
/** Последняя запись по пути: читатель ждёт её, иначе список отстаёт от только что завершённого хода. */
const writes = (host.projectorRecentWrites ??= new Map<string, Promise<unknown>>());

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
  if (!optionalField(value, "failure", isAgentFailure)) return false;
  if (!optionalField(value, "cwd", isText)) return false;
  if (!optionalField(value, "selection", isStringMap)) return false;
  if (!optionalField(value, "permissionMode", isText)) return false;
  if (
    !optionalField(
      value,
      "resume",
      (item) => isRecord(item) && isCount(item.at) && typeof item.auto === "boolean",
    )
  )
    return false;
  return optionalField(value, "awaitingReply", (item) => typeof item === "boolean");
}

async function saveToDisk(path: string, list: RecentRun[]): Promise<void> {
  stores.set(path, list);
  // Каталог недавних запусков закрыт от остальных пользователей, как и сам файл.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path, JSON.stringify(list));
}

function prune(list: RecentRun[], now = Date.now()): RecentRun[] {
  return (
    list
      // A failed run waiting for a quota reset is kept until that reset: a weekly window is
      // longer than the notification lifetime, and losing it loses the "continue" entry.
      .filter(
        (item) =>
          (item.resume !== undefined && item.resume.at > now) ||
          (item.failure?.class === "usage_limit" &&
            (item.failure.resetAt ?? 0) > now &&
            item.failure.resetAt! - now < 31 * 24 * 60 * 60 * 1000) ||
          now - item.endedAt < RECENT_RUN_TTL_MS,
      )
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, RECENT_RUN_LIMIT)
  );
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

/**
 * Запись списка с отметкой «идёт»: ответ агента завершается раньше, чем ложится на диск запись о
 * нём, поэтому список, запрошенный сразу после ответа, дожидается уже начатой записи.
 */
function writeRecentRuns(path: string, task: () => Promise<void>): Promise<void> {
  const write = withFileLock(path, task);
  writes.set(path, write);
  const forget = () => {
    if (writes.get(path) === write) writes.delete(path);
  };
  void write.then(forget, forget);
  return write;
}

/** Записи идут цепочкой по пути, поэтому последняя покрывает предыдущие. */
async function settleWrites(path: string): Promise<void> {
  const pending = writes.get(path);
  if (pending) await pending.catch(() => {});
}

/** Records a finished chat run so the notification center and bell surface completions. */
export async function recordRecentRun(entry: RecentRun): Promise<void> {
  const path = recentRunsPath();
  await writeRecentRuns(path, async () => {
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
  await writeRecentRuns(path, async () => {
    const list = await loadFromDisk(path);
    const filtered = list.filter((item) => item.chat !== chat);
    if (filtered.length === list.length) return;
    await saveToDisk(path, prune(filtered));
  });
}

export async function listRecentRuns(now = Date.now()): Promise<RecentRun[]> {
  const path = recentRunsPath();
  await settleWrites(path);
  const list = await loadFromDisk(path);
  return prune(list, now);
}

/**
 * Sets or clears the continuation planned for a chat. Returns the stored entry, or `undefined`
 * when the chat has no finished run to continue.
 */
export async function setRecentRunResume(
  chat: string,
  resume: { at: number; auto: boolean } | null,
): Promise<RecentRun | undefined> {
  if (!chat) return;
  const path = recentRunsPath();
  let updated: RecentRun | undefined;
  await writeRecentRuns(path, async () => {
    const list = await loadFromDisk(path);
    const index = list.findIndex((item) => item.chat === chat);
    if (index < 0) return;
    const item = { ...list[index]! };
    if (resume) item.resume = resume;
    else delete item.resume;
    list[index] = item;
    updated = item;
    await saveToDisk(path, prune(list));
  });
  if (updated) runsChanged();
  return updated;
}
