import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeUsageError extends Error {}

/**
 * The plan limits Claude Code reports for its own login. The request is made by the `claude` process
 * through the Agent SDK, so Projector never reads, stores or sends the login's token.
 * `null` when plan limits do not apply (API key, Bedrock, Vertex, or no subscription).
 */
export async function readClaudeUsage(timeoutMs = 30000): Promise<unknown> {
  // A query that never gets a prompt: it only answers the question and is closed at once.
  const idle = (async function* () {
    await new Promise<never>(() => {});
  })();
  const session = query({ prompt: idle, options: { cwd: homedir(), settingSources: [] } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const usage = await Promise.race([
      session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return usage.rate_limits_available ? usage.rate_limits : null;
  } catch {
    throw new ClaudeUsageError(
      "Не удалось получить лимиты Claude Code; проверьте вход: claude auth login",
    );
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
