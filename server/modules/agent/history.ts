import { z } from "zod";
import { agentTaskSchema } from "../../../core/modules/agent-task/index.ts";
import { importLegacyHistory, loadHistory, saveHistory } from "./history-store.ts";
import type { ChatIndex } from "./history-store.ts";
interface StoredTurn {
  id: string;
  variants?: StoredTurn[][];
}

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
    tools: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(["running", "done", "error"]),
        input: z.string().optional(),
        detail: z.string(),
        parent: z.string().optional(),
      }),
    ),
    tasks: z.array(agentTaskSchema).optional(),
    content: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("file"),
            path: z.string(),
            directory: z.boolean().optional(),
          }),
          z.object({
            type: z.literal("image"),
            id: z.string(),
            name: z.string(),
            mime: z.string(),
          }),
          z.object({ type: z.literal("command"), name: z.string() }),
        ]),
      )
      .optional(),
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
        ]),
      )
      .optional(),
    /** The isolated copy of the project this answer was written in. */
    worktree: z.object({ id: z.string(), branch: z.string() }).optional(),
    /** Transcript position after this answer: the next message branches off here if needed. */
    tail: z.string().optional(),
    /** The native session cannot be continued from this turn: the chat is replayed instead. */
    detached: z.boolean().optional(),
    /** Other versions of the conversation from this message on (it was edited or repeated). */
    variants: z.array(z.array(turnSchema)).optional(),
    /** Where the shown version stands among `variants`. */
    slot: z.number().int().min(0).optional(),
  }),
);
const schema = z.array(turnSchema);
export async function readAgentHistory(id: string) {
  const saved = loadHistory(id) ?? (await importLegacyHistory(id, (value) => schema.parse(value)));
  return schema.parse(saved ?? []);
}
export async function writeAgentHistory(id: string, value: unknown, index?: ChatIndex) {
  const turns = schema.parse(value);
  saveHistory(id, turns, index);
  return turns;
}
