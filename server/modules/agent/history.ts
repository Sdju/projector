import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
const schema = z
  .array(
    z.object({
      id: z.string().max(100),
      role: z.enum(["user", "assistant"]),
      text: z.string().max(100000),
      /** Native session of the backend that produced this turn, used to resume it. */
      session: z.object({ backend: z.string().max(40), id: z.string().max(200) }).optional(),
      /** The agent process still answering this turn; lets a reloaded page rejoin it. */
      run: z.string().max(40).optional(),
      tools: z
        .array(
          z.object({
            id: z.string().max(100),
            name: z.string().max(100),
            status: z.enum(["running", "done", "error"]),
            input: z.string().max(8000).optional(),
            detail: z.string().max(8000),
          }),
        )
        .max(100),
      context: z
        .object({
          used: z.number(),
          size: z.number(),
          model: z.string().max(100).optional(),
          compactAt: z.number().optional(),
          categories: z
            .array(z.object({ name: z.string().max(100), tokens: z.number() }))
            .max(40)
            .optional(),
          cost: z.object({ amount: z.number(), currency: z.string().max(10) }).optional(),
        })
        .optional(),
      parts: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("text"), text: z.string().max(100000) }),
            z.object({ type: z.literal("tool"), id: z.string().max(100) }),
          ]),
        )
        .max(400)
        .optional(),
    }),
  )
  .max(200);
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
