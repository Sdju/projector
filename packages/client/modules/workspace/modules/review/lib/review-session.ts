import { onBeforeUnmount, provide, ref, watch, type InjectionKey, type Ref } from "vue";

/** A remark on a line or a range of a file in the current review. */
export interface ReviewComment {
  id: string;
  path: string;
  /** First line, counted from 1. */
  from: number;
  /** Last line, counted from 1 and included. */
  to: number;
  /** The Git diff the remark belongs to; absent for a working file. */
  staged?: boolean;
  /** Short excerpt of the remarked lines captured when the remark was opened. */
  snippet?: string;
  text: string;
  createdAt: number;
}

export interface ReviewRange {
  path: string;
  from: number;
  to: number;
  staged?: boolean;
  snippet?: string;
}

export interface ReviewSession {
  comments: Ref<ReviewComment[]>;
  /** Lines the inline composer is writing about; absent when it is closed. */
  composing: Ref<ReviewRange | undefined>;
  /** Remark id currently being edited inline; absent when none is open. */
  editing: Ref<string | undefined>;
  /** Timestamp of the last send to chat; cleared when remarks change. */
  sentAt: Ref<number | undefined>;
  add(input: ReviewRange & { text: string }): ReviewComment;
  update(id: string, text: string): ReviewComment;
  remove(id: string): void;
  clear(): number;
  comment(id: string): ReviewComment | undefined;
  commentsFor(path: string, staged?: boolean): ReviewComment[];
  begin(range: ReviewRange): void;
  edit(id?: string): void;
  finish(text: string): ReviewComment;
  cancel(): void;
  markSent(): void;
  /** Opens or focuses the review tab. */
  open(): void;
  /** Sends all remarks to the agent chat composer. */
  sendToChat(): Promise<unknown>;
}

export const reviewSessionKey: InjectionKey<ReviewSession> = Symbol.for("projector.review");

const storageKey = (projectId: string) => `projector:review:v1:${projectId}`;

function commentId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeSnippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lines = value.replace(/\r\n?/g, "\n").split("\n").slice(0, 4);
  if (!lines.some((line) => line.trim())) return undefined;
  const joined = lines.join("\n");
  return joined.length > 400 ? `${joined.slice(0, 399)}…` : joined;
}

function asRange(value: unknown): ReviewRange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.path !== "string" || !item.path) return undefined;
  if (typeof item.from !== "number" || !Number.isInteger(item.from) || item.from < 1)
    return undefined;
  const to = typeof item.to === "number" ? item.to : item.from;
  if (!Number.isInteger(to) || to < item.from) return undefined;
  const snippet = normalizeSnippet(item.snippet);
  return {
    path: item.path,
    from: item.from,
    to,
    ...(typeof item.staged === "boolean" ? { staged: item.staged } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
  };
}

function asComment(value: unknown): ReviewComment | undefined {
  const range = asRange(value);
  if (!range || !value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return undefined;
  if (typeof item.text !== "string" || !item.text.trim()) return undefined;
  const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
  return { ...range, id: item.id, text: item.text.trim(), createdAt };
}

function load(projectId: string): { comments: ReviewComment[] } {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return { comments: [] };
    const parsed = JSON.parse(raw) as { comments?: unknown };
    const comments = Array.isArray(parsed.comments)
      ? parsed.comments.map(asComment).filter((item): item is ReviewComment => !!item)
      : [];
    return { comments };
  } catch {
    return { comments: [] };
  }
}

function persist(projectId: string, comments: ReviewComment[]) {
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify({ comments }));
  } catch {
    // Private mode or a full store: the review still works until reload.
  }
}

function normalizeRange(range: ReviewRange): ReviewRange {
  if (!range.path.trim()) throw new Error("Укажите путь файла");
  if (!Number.isInteger(range.from) || range.from < 1)
    throw new Error("from: нужно целое число от 1");
  const to = range.to;
  if (!Number.isInteger(to) || to < range.from)
    throw new Error("to: конец диапазона раньше начала");
  const snippet = normalizeSnippet(range.snippet);
  return {
    path: range.path,
    from: range.from,
    to,
    ...(typeof range.staged === "boolean" ? { staged: range.staged } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
  };
}

/** Staged diff remarks belong only to staged diffs; working-file and working-diff share the working side. */
export function matchesReviewSide(item: { staged?: boolean }, staged?: boolean): boolean {
  return staged === true ? item.staged === true : item.staged !== true;
}

/** In-memory review: tests and the workspace composable share this. */
export function createReviewSession(
  initial: { comments?: ReviewComment[] } = {},
  options: { openTab?: () => void; sendToChat?: () => Promise<unknown> } = {},
): ReviewSession {
  const comments = ref(initial.comments ?? []);
  const composing = ref<ReviewRange>();
  const editing = ref<string>();
  const sentAt = ref<number>();

  function add(input: ReviewRange & { text: string }) {
    const range = normalizeRange(input);
    const text = input.text.trim();
    if (!text) throw new Error("Напишите замечание");
    const comment: ReviewComment = { ...range, id: commentId(), text, createdAt: Date.now() };
    comments.value = [...comments.value, comment];
    sentAt.value = undefined;
    return comment;
  }

  function update(id: string, rawText: string) {
    const text = rawText.trim();
    if (!text) throw new Error("Напишите замечание");
    let updated: ReviewComment | undefined;
    const next = comments.value.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, text };
      return updated;
    });
    if (!updated) throw new Error("Замечание не найдено");
    comments.value = next;
    if (editing.value === id) editing.value = undefined;
    sentAt.value = undefined;
    return updated;
  }

  return {
    comments,
    composing,
    editing,
    sentAt,
    add,
    update,
    remove(id) {
      const next = comments.value.filter((item) => item.id !== id);
      if (next.length === comments.value.length) throw new Error("Замечание не найдено");
      comments.value = next;
      if (editing.value === id) editing.value = undefined;
      if (!next.length) sentAt.value = undefined;
    },
    clear() {
      const count = comments.value.length;
      comments.value = [];
      composing.value = undefined;
      editing.value = undefined;
      sentAt.value = undefined;
      return count;
    },
    comment(id) {
      return comments.value.find((item) => item.id === id);
    },
    commentsFor(path, staged) {
      return comments.value.filter((item) => item.path === path && matchesReviewSide(item, staged));
    },
    begin(range) {
      editing.value = undefined;
      composing.value = normalizeRange(range);
    },
    edit(id) {
      if (id !== undefined && !comments.value.some((item) => item.id === id))
        throw new Error("Замечание не найдено");
      composing.value = undefined;
      editing.value = id;
    },
    finish(text) {
      const range = composing.value;
      if (!range) throw new Error("Нет незавершённого замечания");
      const comment = add({ ...range, text });
      composing.value = undefined;
      return comment;
    },
    cancel() {
      composing.value = undefined;
      editing.value = undefined;
    },
    markSent() {
      sentAt.value = Date.now();
    },
    open: () => options.openTab?.(),
    sendToChat: () => options.sendToChat?.() ?? Promise.resolve(),
  };
}

/** Creates the review of one workspace: remarks live in this tab until they go to chat. */
export function useReviewSession(
  projectId: () => string,
  options: { openTab: () => void; sendToChat?: () => Promise<unknown> },
): ReviewSession {
  const session = createReviewSession(load(projectId()), options);
  const stop = watch(session.comments, () => persist(projectId(), session.comments.value), {
    deep: true,
  });
  onBeforeUnmount(stop);
  provide(reviewSessionKey, session);
  return session;
}
