import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** Claude Code names the folder of a project after its path with every other character a dash. */
const folderOf = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

async function transcript(cwd: string, sessionId: string): Promise<string | undefined> {
  const root = join(configDir(), "projects");
  const file = `${sessionId}.jsonl`;
  const direct = await readFile(join(root, folderOf(cwd), file), "utf8").catch(() => undefined);
  if (direct !== undefined) return direct;
  // Long paths are shortened with a hash: look for the session in every project.
  for (const folder of await readdir(root).catch(() => [] as string[])) {
    const text = await readFile(join(root, folder, file), "utf8").catch(() => undefined);
    if (text !== undefined) return text;
  }
  return undefined;
}

/** Message `uuid` → when it was written (ms), read from the stored transcript. */
export function messageTimes(text: string): Map<string, number> {
  const times = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line.includes('"timestamp"')) continue;
    try {
      const { uuid, timestamp } = JSON.parse(line) as { uuid?: unknown; timestamp?: unknown };
      const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
      if (typeof uuid === "string" && Number.isFinite(time)) times.set(uuid, time);
    } catch {
      // A torn last line of a transcript still being written.
    }
  }
  return times;
}

export async function claudeMessageTimes(
  cwd: string,
  sessionId: string,
): Promise<Map<string, number>> {
  const text = await transcript(cwd, sessionId);
  return text ? messageTimes(text) : new Map();
}
