// The process side of a hosted run: one agent answer, held by its own process so that a server
// restart or a hot reload leaves it going. `agent-host.mjs` keeps this process and its trace (see
// `hosted-process.ts`); the server only relays what it prints and the answers it reads.
//
// Lines on stdout are either
//   {"event": name, "data": data}                  an event of the answer, shown as it is
//   {"id": id, "method": name, "params": data}     a question for the user, answered by the server
// and lines on stdin are either
//   {"id": id, "result": {output|error}}           the user's answer to such a question
//   {"method": "inject", "params": {...}}          a message the user added while the answer runs
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentRunRecord } from "./agent-runs.ts";
import type { AgentEmitter, AgentRunOptions } from "./backend.ts";
import {
  completeCommandRequest,
  createApprovalBridge,
  createCommandBridge,
  createQuestionBridge,
  createSecretBridge,
} from "./command-bridge.ts";
import { injectMessage } from "./injection.ts";

const REQUESTS = new Set([
  "permission-request",
  "question-request",
  "command-request",
  "secret-request",
]);
/** After the host's stop signal the agent gets this long to end its tools before the process goes. */
const STOP_GRACE_MS = 2000;

const write = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);

const emit: AgentEmitter = (event, data) => {
  const id = (data as { id?: unknown } | undefined)?.id;
  if (REQUESTS.has(event) && typeof id === "string") write({ id, method: event, params: data });
  else write({ event, data });
};

/**
 * Runs `answer` with the request the server stored in the run directory (`process.argv[2]`) and
 * ends the process when it is done. The host stops a run with SIGTERM: the answer's `abort` signal
 * fires so tools can end what they started, and the process leaves after a short grace.
 */
export function runHostedRunner(answer: (options: AgentRunOptions) => Promise<void>): void {
  main(answer).then(
    () => process.exit(0),
    (error: unknown) => {
      write({
        event: "error",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      process.exit(1);
    },
  );
}

async function main(answer: (options: AgentRunOptions) => Promise<void>): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: <runner> <run directory>");
  const record = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as AgentRunRecord;
  const controller = new AbortController();
  const signal = controller.signal;
  // The host signals the group and then the runner itself: a second SIGTERM must not hit the
  // default action before the tools have ended what they started, so the handler stays.
  process.on("SIGTERM", () => {
    if (controller.signal.aborted) return;
    controller.abort();
    setTimeout(() => process.exit(143), STOP_GRACE_MS).unref();
  });

  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as {
      id?: string;
      result?: { output?: unknown; error?: string };
      method?: string;
      params?: { messageId?: string; text?: string };
    };
    if (message.method === "inject") {
      if (message.params?.messageId && typeof message.params.text === "string")
        injectMessage(message.params.messageId, message.params.text);
    } else if (typeof message.id === "string" && message.result) {
      completeCommandRequest(message.id, message.result);
    }
  });

  const options: AgentRunOptions = {
    backend: record.backend,
    permissionMode: record.permissionMode,
    selection: record.selection,
    message: record.message,
    parts: record.parts,
    cwd: record.cwd,
    history: record.history,
    sessionId: record.sessionId,
    messageId: record.messageId,
    tail: record.tail,
    providerId: record.providerId,
    abort: signal,
    emit,
    ...(record.approvals
      ? {
          approve: createApprovalBridge((event, data) => emit(event, data), signal),
          ask: createQuestionBridge((event, data) => emit(event, data), signal),
          secret: createSecretBridge((event, data) => emit(event, data), signal),
        }
      : {}),
    ...(record.commandBridge
      ? { commands: createCommandBridge((event, data) => emit(event, data), signal) }
      : {}),
  };
  try {
    await answer(options);
  } catch (error) {
    emit("error", { error: error instanceof Error ? error.message : String(error) });
  }
}
