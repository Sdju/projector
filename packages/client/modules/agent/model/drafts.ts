import type { MessagePart } from "./types.ts";

/** What a chat opened by a fork starts with in its input. */
export interface PendingDraft {
  text: string;
  parts: MessagePart[];
}

// A fork opens a tab that mounts later: the draft waits here until that chat's state exists.
const drafts = new Map<string, PendingDraft>();

export function holdDraft(key: string, draft: PendingDraft): void {
  drafts.set(key, draft);
}

/** The draft of a chat being opened; it is handed over once. */
export function takeDraft(key: string): PendingDraft | undefined {
  const draft = drafts.get(key);
  drafts.delete(key);
  return draft;
}
