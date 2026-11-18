import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";
import { answerPreview } from "@ai-projector/core/modules/agent-answer/index.ts";
import type { AgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";
import {
  agentLabel,
  type AgentBackendId,
  type AgentJobStatus,
  type AgentJobView,
  type AgentRunPending,
  type LiveAgentRun,
  type RecentAgentRun,
} from "../../../../agent-core/index.ts";
import { deviceBase } from "../../../../../common/utilities/device-url.ts";
import { projectRoute } from "../../../../project/index.ts";

/** Finished work older than this is history, not a notification. */
export const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;
/** Unseen completions within this window are treated as fresh when a page first loads. */
export const RECENT_UNREAD_MS = 10 * 60 * 1000;

export type InboxCategory = "attention" | "working" | "finished";
export type InboxPending = AgentRunPending;

/** One Projector instance: this page's device or a connected device of the Hub. */
export interface InboxSource {
  id: string;
  name: string;
  /** API prefix of another device (`/api/devices/<id>`); empty for this page's device. */
  base: string;
  current: boolean;
}

export interface InboxProject {
  id: string;
  name: string;
  path: string;
}

export interface InboxItem {
  /** Stable across refreshes: source, kind and id. */
  key: string;
  kind: "job" | "run";
  id: string;
  sourceId: string;
  sourceName: string;
  sourceBase: string;
  projectId: string;
  projectPath?: string;
  projectName: string;
  backend: AgentBackendId;
  agent: string;
  topic: string;
  status: AgentJobStatus;
  category: InboxCategory;
  pending: InboxPending[];
  error?: string;
  /** Safe class, code and reset time, when the source reported them. */
  failure?: AgentFailure;
  resultPreview?: string;
  awaitingReply?: boolean;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  chat?: string;
  /** The full background job, so the panel can show and answer its requests. */
  job?: AgentJobView;
}

export interface InboxGroup {
  key: string;
  sourceId: string;
  sourceName: string;
  projectId: string;
  projectName: string;
  projectPath?: string;
  items: InboxItem[];
  attention: number;
  working: number;
  finished: number;
}

export interface InboxNotice {
  key: string;
  title: string;
  body: string;
  href?: string;
}

/** The device id in a Hub device URL, or an empty string outside the Hub. */
export function currentDeviceId(path = deviceBase()): string {
  return /^\/devices\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(path)?.[1] ?? "";
}

/** Online devices of the Hub, or only this page's device when the Hub list is unavailable. */
export function inboxSourcesFromDevices(
  devices: readonly HubDevice[],
  current: string,
): InboxSource[] {
  const online = devices.filter((device) => device.online);
  const sources = online.map((device) => ({
    id: device.id,
    name: device.name,
    base: `/api/devices/${device.id}`,
    current: device.id === current,
  }));
  if (current && !sources.some((source) => source.current))
    sources.unshift({ id: current, name: "Это устройство", base: "", current: true });
  return sources;
}

export function jobCategory(job: AgentJobView): InboxCategory {
  if (job.pending.length || job.status === "needs-user" || job.status === "error")
    return "attention";
  if (job.status === "running" || job.status === "queued") return "working";
  return "finished";
}

const projectOf = (projects: readonly InboxProject[], projectId: string) =>
  projects.find((project) => project.id === projectId);

export function inboxJobItem(
  source: InboxSource,
  job: AgentJobView,
  projects: readonly InboxProject[] = [],
): InboxItem {
  const project = projectOf(projects, job.projectId);
  const resultPreview = answerPreview(job.resultPreview ?? job.result ?? "", 300);
  return {
    key: `${source.id}|job|${job.id}`,
    kind: "job",
    id: job.id,
    sourceId: source.id,
    sourceName: source.name,
    sourceBase: source.base,
    projectId: job.projectId,
    projectPath: project?.path,
    projectName: project?.name ?? job.projectId,
    backend: job.backend,
    agent: agentLabel(job.backend),
    topic: job.task.trim().slice(0, 120),
    status: job.status,
    category: jobCategory(job),
    pending: job.pending,
    error: job.error,
    ...(job.failure ? { failure: job.failure } : {}),
    ...(resultPreview ? { resultPreview } : {}),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    job,
  };
}

export function inboxRunItem(
  source: InboxSource,
  run: LiveAgentRun,
  projects: readonly InboxProject[] = [],
): InboxItem {
  const project = projectOf(projects, run.projectId);
  const pending = run.pending ?? [];
  const waiting = run.status === "needs-user" || pending.length > 0;
  return {
    key: `${source.id}|run|${run.id}`,
    kind: "run",
    id: run.id,
    sourceId: source.id,
    sourceName: source.name,
    sourceBase: source.base,
    projectId: run.projectId,
    projectPath: project?.path,
    projectName: project?.name ?? run.projectId,
    backend: run.backend,
    agent: agentLabel(run.backend),
    topic: run.topic.trim().slice(0, 120),
    status: waiting ? "needs-user" : "running",
    category: waiting ? "attention" : "working",
    pending,
    createdAt: run.startedAt ?? Date.now(),
    startedAt: run.startedAt,
    chat: run.chat,
  };
}

export function inboxRecentRunItem(
  source: InboxSource,
  run: RecentAgentRun,
  projects: readonly InboxProject[] = [],
): InboxItem {
  const project = projectOf(projects, run.projectId);
  const attention = run.status === "error" || run.awaitingReply === true;
  return {
    key: `${source.id}|run|${run.id}`,
    kind: "run",
    id: run.id,
    sourceId: source.id,
    sourceName: source.name,
    sourceBase: source.base,
    projectId: run.projectId,
    projectPath: project?.path,
    projectName: project?.name ?? run.projectId,
    backend: run.backend,
    agent: agentLabel(run.backend),
    topic: run.topic.trim().slice(0, 120),
    status: run.awaitingReply ? "needs-user" : run.status,
    category: attention ? "attention" : "finished",
    pending: [],
    error: run.error,
    ...(run.failure ? { failure: run.failure } : {}),
    resultPreview: run.resultPreview ? answerPreview(run.resultPreview, 300) : undefined,
    awaitingReply: run.awaitingReply,
    createdAt: run.startedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    chat: run.chat,
  };
}

/** Merges live and recently finished chat runs, keeping live state when both overlap. */
export function mergeRunItems(
  source: InboxSource,
  runs: readonly LiveAgentRun[],
  recent: readonly RecentAgentRun[],
  projects: readonly InboxProject[] = [],
): InboxItem[] {
  const activeIds = new Set(runs.map((run) => run.id));
  const activeChats = new Set(runs.map((run) => run.chat).filter(Boolean));
  const finished = recent
    .filter(
      (run) =>
        Date.now() - run.endedAt < FINISHED_TTL_MS &&
        !activeIds.has(run.id) &&
        (!run.chat || !activeChats.has(run.chat)),
    )
    .map((run) => inboxRecentRunItem(source, run, projects));
  return [...runs.map((run) => inboxRunItem(source, run, projects)), ...finished];
}

const categoryOrder: Record<InboxCategory, number> = { attention: 0, working: 1, finished: 2 };

/** Newest work first inside each category; groups follow the device, then the project. */
export function inboxGroups(items: readonly InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const item of items) {
    const key = `${item.sourceId}|${item.projectId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        projectId: item.projectId,
        projectName: item.projectName,
        projectPath: item.projectPath,
        items: [],
        attention: 0,
        working: 0,
        finished: 0,
      };
      groups.set(key, group);
    }
    if (!group.projectPath && item.projectPath) group.projectPath = item.projectPath;
    group.items.push(item);
    group[item.category]++;
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.items.sort(
      (a, b) =>
        categoryOrder[a.category] - categoryOrder[b.category] ||
        (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt),
    );
  }
  return list.sort(
    (a, b) =>
      a.sourceName.localeCompare(b.sourceName) || a.projectName.localeCompare(b.projectName),
  );
}

/** The page where the user answers or watches this work. */
export function inboxHref(item: InboxItem, sources: readonly InboxSource[]): string | undefined {
  if (!item.projectPath) return undefined;
  const source = sources.find((entry) => entry.id === item.sourceId);
  const prefix = !item.sourceId || source?.current ? deviceBase() : `/devices/${item.sourceId}`;
  const query =
    item.kind === "job"
      ? `?job=${encodeURIComponent(item.id)}`
      : `?chat=${encodeURIComponent(item.chat ?? "")}`;
  return `${prefix}${projectRoute(item.projectPath)}${query}`;
}

function pendingBody(card: InboxPending, topic: string): string {
  if (card.kind === "permission" && card.judge)
    return `Судья ${card.judge.score}/5 (${card.judge.label}) — ${card.judge.reason}: ${card.title}`;
  if (card.kind === "question") return `${card.questions?.[0]?.question || card.title}: ${topic}`;
  if (card.kind === "secret") return `Секрет «${card.title}»: ${topic}`;
  return `${card.title}: ${topic}`;
}

function noticeOf(item: InboxItem): InboxNotice | undefined {
  const who = item.agent;
  const title =
    item.status === "needs-user" || item.pending.length
      ? `${who} ждёт вашего ответа`
      : item.status === "error"
        ? `${who}: ${item.kind === "job" ? "задание завершилось ошибкой" : "ошибка агента"}`
        : item.status === "done"
          ? `${who} ${item.kind === "job" ? "закончил задание" : "закончил работу"}`
          : item.status === "stopped"
            ? `${who}: ${item.kind === "job" ? "задание остановлено" : "работа остановлена"}`
            : "";
  if (!title) return undefined;
  const card = item.pending[0];
  return {
    key: item.key,
    title,
    body: card
      ? pendingBody(card, item.topic)
      : item.awaitingReply
        ? `Форма ответа: ${item.topic}`
        : item.status === "error" && item.error
          ? item.error
          : item.resultPreview || item.topic,
  };
}

/**
 * What changed since the last look. A request is announced once: the signature includes the
 * status and the ids of the pending cards, and the map outlives hiding and showing the page.
 * The first look only records what is already there.
 */
export function inboxNotices(
  known: Map<string, string>,
  items: readonly InboxItem[],
  firstLook: boolean,
  hrefOf: (item: InboxItem) => string | undefined = () => undefined,
): InboxNotice[] {
  const notices: InboxNotice[] = [];
  for (const item of items) {
    const signature = `${item.status}|${item.awaitingReply ? "reply" : ""}|${item.pending.map((card) => card.id).join(",")}`;
    const before = known.get(item.key);
    known.set(item.key, signature);
    if (before === signature) continue;
    const firstSight = before === undefined;
    if (firstLook && firstSight) continue;
    if (firstSight && item.category === "finished") continue;
    const notice = noticeOf(item);
    if (notice) notices.push({ ...notice, href: hrefOf(item) });
  }
  return notices;
}
