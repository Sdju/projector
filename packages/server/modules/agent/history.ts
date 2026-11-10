import { z } from "zod";
import { agentTaskSchema } from "@ai-projector/core/modules/agent-task/index.ts";
import {
  importLegacyHistory,
  loadHistory,
  saveChatFeatures,
  saveHistory,
} from "./history-store.ts";
import { saveChatJudge } from "./judge-store.ts";
import { saveChatQueue } from "./queue-store.ts";
import { saveChatRole } from "./role-store.ts";
import { normalizeJudgeOverride } from "@ai-projector/core/modules/agent-judge/index.ts";
import { normalizeRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import type { ChatIndex } from "./history-store.ts";
interface StoredTurn {
  id: string;
  variants?: StoredTurn[][];
  auto?: string;
  autoTitle?: string;
  injected?: string;
}

const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("file"),
    path: z.string(),
    directory: z.boolean().optional(),
    range: z
      .object({ from: z.number().int().positive(), to: z.number().int().positive() })
      .refine((range) => range.to >= range.from)
      .optional(),
  }),
  z.object({
    type: z.literal("image"),
    id: z.string(),
    name: z.string(),
    mime: z.string(),
  }),
  z.object({ type: z.literal("command"), name: z.string() }),
]);
const formSchema = z.object({
  source: z.string(),
  values: z.unknown(),
  summary: z.string().optional(),
});
const queueSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    parts: z.array(partSchema),
    form: formSchema.optional(),
    auto: z.string().optional(),
    autoTitle: z.string().optional(),
  }),
);
const turnSchema: z.ZodType<StoredTurn> = z.lazy(() =>
  z.object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    /** When the message was written (ms since the epoch). */
    at: z.number().optional(),
    /** Native session of the backend that produced this turn, used to resume it. */
    session: z.object({ backend: z.string(), id: z.string() }).optional(),
    /** The agent process still answering this turn; lets a reloaded page rejoin it. */
    run: z.string().optional(),
    /** The IDE wrote this message after a job: shown as a note with the job's name. */
    auto: z.string().optional(),
    autoTitle: z.string().optional(),
    /** Projector's instructions before a native session's first user message, shown separately. */
    injected: z.string().optional(),
    tools: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(["running", "done", "error"]),
        input: z.string().optional(),
        detail: z.string(),
        parent: z.string().optional(),
        /** When the call started and ended (ms since the epoch), for showing how long it took. */
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
      }),
    ),
    tasks: z.array(agentTaskSchema).optional(),
    content: z.array(partSchema).optional(),
    /** A form answer: the block the user filled and the values that were sent. */
    form: formSchema.optional(),
    /** Tokens, cache use and cost of the answer, for the usage tooltip after a reload. */
    usage: z
      .object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        first: z
          .object({
            input: z.number(),
            output: z.number(),
            cacheRead: z.number(),
            cacheWrite: z.number(),
          })
          .optional(),
        cost: z.number().optional(),
      })
      .optional(),
    context: z
      .object({
        used: z.number(),
        size: z.number(),
        model: z.string().optional(),
        compactAt: z.number().optional(),
        categories: z.array(z.object({ name: z.string(), tokens: z.number() })).optional(),
        cost: z.object({ amount: z.number(), currency: z.string() }).optional(),
      })
      .optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({ type: z.literal("tool"), id: z.string() }),
          z.object({ type: z.literal("note"), text: z.string() }),
          z.object({ type: z.literal("thought"), text: z.string() }),
          z.object({
            type: z.literal("judge"),
            tool: z.string(),
            title: z.string().optional(),
            verdict: z.object({
              score: z.union([
                z.literal(1),
                z.literal(2),
                z.literal(3),
                z.literal(4),
                z.literal(5),
              ]),
              label: z.string(),
              reason: z.string(),
              confidence: z.enum(["high", "medium", "low"]),
              effect: z.string().optional(),
            }),
            decision: z.literal("auto"),
            at: z.number(),
          }),
        ]),
      )
      .optional(),
    /** The isolated copy of the project this answer was written in. */
    worktree: z.object({ id: z.string(), branch: z.string() }).optional(),
    /** Transcript position after this answer: the next message branches off here if needed. */
    tail: z.string().optional(),
    /** The native session cannot be continued from this turn: the chat is replayed instead. */
    detached: z.boolean().optional(),
    /** What Answer Doctor did with this answer, so the mark survives a reload. */
    doctor: z
      .object({
        status: z.enum(["fixed", "failed"]),
        attempts: z.number().int().min(1),
        problem: z.string(),
        remaining: z.string().optional(),
        took: z.number().min(0),
        answer: z.number().int(),
        at: z.number(),
      })
      .optional(),
    /** Other versions of the conversation from this message on (it was edited or repeated). */
    variants: z.array(z.array(turnSchema)).optional(),
    /** Where the shown version stands among `variants`. */
    slot: z.number().int().min(0).optional(),
  }),
);
const schema = z.array(turnSchema);
const featuresSchema = z.array(z.string().min(1).max(64)).max(50);
export async function readAgentHistory(id: string) {
  const saved = loadHistory(id) ?? (await importLegacyHistory(id, (value) => schema.parse(value)));
  return schema.parse(saved ?? []);
}
export async function writeAgentHistory(
  id: string,
  value: unknown,
  index?: ChatIndex,
  features?: unknown,
  judge?: unknown,
  role?: unknown,
  queue?: unknown,
) {
  const turns = schema.parse(value);
  // Parsed before anything is written: a broken queue must not leave the chat half saved.
  const queued = queue === undefined ? undefined : queue === null ? null : queueSchema.parse(queue);
  saveHistory(id, turns, index);
  // `undefined` keeps the chat's choice; `null` clears it back to the user's defaults.
  if (features !== undefined)
    saveChatFeatures(id, features === null ? null : featuresSchema.parse(features));
  if (judge !== undefined)
    saveChatJudge(id, judge === null ? null : (normalizeJudgeOverride(judge) ?? null));
  if (role !== undefined)
    saveChatRole(id, role === null ? null : (normalizeRoleSnapshot(role) ?? null));
  // `undefined` keeps a queue saved before the field existed; `null` or `[]` empties it.
  if (queued !== undefined) saveChatQueue(id, queued);
  return turns;
}
