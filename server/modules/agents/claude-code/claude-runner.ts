// One Claude Code run, held by its own process so that a server restart or a hot reload leaves the
// answer going. `agent-host.mjs` keeps this process and its trace (see `hosted-process.ts`); the
// server only relays what it prints and the answers it reads.
//
// Usage: node claude-runner.ts <run directory>
//
// The run directory holds `run.json`, the request the server stored. Lines on stdout are either
//   {"event": name, "data": data}                  an event of the answer, shown as it is
//   {"id": id, "method": name, "params": data}     a question for the user, answered by the server
// and lines on stdin are either
//   {"id": id, "result": {output|error}}           the user's answer to such a question
//   {"method": "inject", "params": {...}}          a message the user added while the answer runs
import {
  injectMessage,
  completeCommandRequest,
  createApprovalBridge,
  createCommandBridge,
  createQuestionBridge,
} from "../../agent/index.ts";
import type { AgentRunRecord, AgentEmitter, AgentRunOptions } from "../../agent/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runClaudeCode } from "./claude-code-backend.ts";

const REQUESTS = new Set(["permission-request", "question-request", "command-request"]);

const write = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);

const emit: AgentEmitter = (event, data) => {
  const id = (data as { id?: unknown } | undefined)?.id;
  if (REQUESTS.has(event) && typeof id === "string") write({ id, method: event, params: data });
  else write({ event, data });
};

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: claude-runner.ts <run directory>");
  const record = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as AgentRunRecord;
  // The server ends a run by stopping this process tree; nothing here aborts it.
  const signal = new AbortController().signal;

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
        }
      : {}),
    ...(record.commandBridge
      ? { commands: createCommandBridge((event, data) => emit(event, data), signal) }
      : {}),
  };
  try {
    await runClaudeCode(options);
  } catch (error) {
    emit("error", { error: error instanceof Error ? error.message : String(error) });
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    write({
      event: "error",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    process.exit(1);
  },
);
