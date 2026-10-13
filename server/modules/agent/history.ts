import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
interface StoredTurn {
  variants?: StoredTurn[][];
}

const turnSchema: z.ZodType<StoredTurn> = z.lazy(() =>
  z.object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
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
      }),
    ),
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
    context: z
      .object({
        used: z.number(),
        size: z.number(),
        model: z.string().optional(),
        compactAt: z.number().optional(),
        categories: z
          .array(z.object({ name: z.string(), tokens: z.number() }))

          .optional(),
        cost: z.object({ amount: z.number(), currency: z.string() }).optional(),
      })
      .optional(),
    parts: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({ type: z.literal("tool"), id: z.string() }),
        ]),
      )

      .optional(),
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
function historyPath(id: string) {
  return join(dataDir(), "agent", `${createHash("sha256").update(id).digest("hex")}.json`);
}
export async function readAgentHistory(id: string) {
  try {
    return schema.parse(JSON.parse(await readFile(historyPath(id), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function writeAgentHistory(id: string, value: unknown) {
  const turns = schema.parse(value);
  const path = historyPath(id);
  await mkdir(join(dataDir(), "agent"), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(turns), { mode: 0o600 });
  await rename(temp, path);
  return turns;
}
