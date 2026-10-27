import { createInterface } from "node:readline";
import type { AgentProcessSpec } from "../../../core/modules/os/index.ts";
import type { AgentEventName, AgentRunHandle, AgentRunOptions } from "./backend.ts";
import { relayRequest, unrelayRequests } from "./command-bridge.ts";
import { runDirectory } from "./agent-runs.ts";
import { attachHosted, startHosted } from "./hosted-process.ts";
import { registerInjector } from "./injection.ts";

/**
 * The answer of a hosted run: its runner (see `hosted-runner.ts`) keeps going while this server is
 * away, so the answer is followed through the host's trace. Questions for the user are relayed to
 * the client; the answers come back through `completeCommandRequest` and are written to the runner.
 * `injectable` is the message id a follow-up written during the answer is delivered to.
 */
export async function runHostedAgent(
  options: AgentRunOptions,
  handle: AgentRunHandle,
  launch: { runner: string; cwd: string; env: AgentProcessSpec["env"] },
  injectable?: string,
): Promise<void> {
  const proc = handle.attach
    ? await attachHosted(handle.id)
    : await startHosted(handle.id, {
        command: process.execPath,
        args: [launch.runner, runDirectory(handle.id)],
        cwd: launch.cwd,
        env: launch.env,
      });
  const relayedIds: string[] = [];
  // An answer that arrives after the run ended has nothing to reach: it is dropped.
  const answer = (id: string, result: object) => {
    if (proc.stdin.writable) proc.stdin.write(`${JSON.stringify({ id, result })}\n`);
  };
  const lines = createInterface({ input: proc.stdout });
  lines.on("line", (line) => {
    let message: {
      event?: AgentEventName;
      data?: unknown;
      id?: string;
      method?: AgentEventName;
      params?: unknown;
    };
    try {
      message = JSON.parse(line);
    } catch {
      // Not a line the runner writes: nothing to show, and it must not take the server down.
      return;
    }
    if (message.method && message.id !== undefined) {
      const id = String(message.id);
      relayedIds.push(id);
      relayRequest(id, (result) => answer(id, result));
      options.emit(message.method, message.params);
    } else if (message.event) options.emit(message.event, message.data);
  });
  // A message the user adds during the answer goes to the runner's input.
  const unregister = injectable
    ? registerInjector(injectable, (text) => {
        if (!proc.stdin.writable) return false;
        proc.stdin.write(
          `${JSON.stringify({ method: "inject", params: { messageId: injectable, text } })}\n`,
        );
        return true;
      })
    : undefined;
  const stop = () => void proc.terminate();
  options.abort?.addEventListener("abort", stop, { once: true });
  if (options.abort?.aborted) stop();
  try {
    await new Promise<void>((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", () => resolve());
    });
  } finally {
    options.abort?.removeEventListener("abort", stop);
    unregister?.();
    unrelayRequests(relayedIds);
    lines.close();
  }
}
