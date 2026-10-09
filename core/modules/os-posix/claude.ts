import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Read Claude Code's login without modifying or renewing its credentials. */
export async function readClaudeAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    const directory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    auth = JSON.parse(await readFile(join(directory, ".credentials.json"), "utf8"));
  } catch {
    throw new Error("Авторизация Claude Code недоступна; выполните claude auth login");
  }
  const oauth =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).claudeAiOauth : null;
  const token =
    oauth && typeof oauth === "object" ? (oauth as Record<string, unknown>).accessToken : null;
  if (typeof token !== "string" || !token.trim())
    throw new Error("Claude Code не подключён через OAuth; выполните claude auth login");
  return token;
}
