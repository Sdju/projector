import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";
import type { AcpFollowUp, AcpFollowUpOptions, AcpFollowUpResult } from "../acp/index.ts";
import { kimiMainAgentDirectory } from "./background-state.ts";

const START_WAIT_MS = 4_000;
const QUIET_AFTER_NOTIFY_MS = 1_200;
const POLL_INTERVAL_MS = 250;
const TOTAL_WAIT_MS = 20 * 60_000;

interface KimiWireWatchOptions {
  home?: string;
  intervalMs?: number;
  startMs?: number;
  quietMs?: number;
  totalMs?: number;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function inferToolKind(name: unknown): string {
  switch (name) {
    case "Read":
    case "Glob":
    case "Grep":
      return "read";
    case "Write":
    case "Edit":
      return "edit";
    case "Bash":
    case "Terminal":
      return "execute";
    case "WebFetch":
    case "WebSearch":
      return "fetch";
    case "Think":
      return "think";
    default:
      return "other";
  }
}

function asId(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function toolResultText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      const text = (item as { text?: unknown } | null)?.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Reads complete newline-delimited lines appended after `offset` bytes. */
function readAppendedLines(file: string, offset: number): { lines: string[]; nextOffset: number } {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return { lines: [], nextOffset: offset };
  }
  if (size <= offset) return { lines: [], nextOffset: offset };
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const length = size - offset;
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    if (bytesRead <= 0) return { lines: [], nextOffset: offset };
    const slice = buffer.subarray(0, bytesRead);
    const lastNewline = slice.lastIndexOf(0x0a);
    if (lastNewline < 0) return { lines: [], nextOffset: offset };
    const text = slice.subarray(0, lastNewline).toString("utf8");
    return {
      lines: text ? text.split("\n") : [],
      nextOffset: offset + lastNewline + 1,
    };
  } catch {
    return { lines: [], nextOffset: offset };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore close errors */
      }
    }
  }
}

function initialWireOffset(file: string): number {
  try {
    return existsSync(file) ? statSync(file).size : 0;
  } catch {
    return 0;
  }
}

/**
 * Kimi 2.7+ ends the current ACP turn (`completionHandoff`) when a background task finishes during
 * `WaitFor`, then runs an automatic `trigger: "notify"` turn without streaming it over ACP because
 * `AcpSession.driverFor(turnId)` drops events from other turn ids. Keep the connection open (so
 * approvals still arrive) and tail `wire.jsonl` until the notify turn finishes.
 */
export function prepareKimiFollowUp(
  sessionId: string,
  config: KimiWireWatchOptions = {},
): AcpFollowUp {
  const home = config.home ?? os.homeDirectory();
  const resolveWire = () => {
    const dir = kimiMainAgentDirectory(sessionId, home);
    return dir ? join(dir, "wire.jsonl") : undefined;
  };
  let wirePath = resolveWire();
  let offset = wirePath ? initialWireOffset(wirePath) : 0;

  return {
    acceptsUpdates: () => true,
    async wait(options: AcpFollowUpOptions): Promise<AcpFollowUpResult> {
      const intervalMs = config.intervalMs ?? POLL_INTERVAL_MS;
      const startMs = config.startMs ?? START_WAIT_MS;
      const quietMs = config.quietMs ?? QUIET_AFTER_NOTIFY_MS;
      const totalMs = config.totalMs ?? TOTAL_WAIT_MS;
      const startedAt = Date.now();
      let activeNotifyTurn: string | undefined;
      let started = false;
      let endedNotify = false;
      let idleSince: number | undefined;
      const toolTurns = new Map<string, string>();

      while (true) {
        if (options.signal?.aborted) return { status: "aborted" };
        const openBackground = options.pending();
        wirePath ??= resolveWire();
        if (wirePath) {
          const { lines, nextOffset } = readAppendedLines(wirePath, offset);
          offset = nextOffset;
          for (const raw of lines) {
            if (!raw.trim()) continue;
            let record: Record<string, unknown>;
            try {
              record = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }
            const type = record.type;
            if (type === "turn.prompt") {
              if (record.trigger === "notify") {
                activeNotifyTurn = asId(record.turnId);
                endedNotify = false;
                idleSince = undefined;
                if (!started) {
                  started = true;
                  options.onStart?.();
                }
              } else {
                return { status: "superseded" };
              }
              continue;
            }
            if (activeNotifyTurn === undefined) continue;
            if (type === "context.append_loop_event") {
              const event = (record.event ?? {}) as Record<string, unknown>;
              const eventType = event.type;
              if (eventType === "content.part") {
                const part = (event.part ?? {}) as Record<string, unknown>;
                if (part.type === "think" && typeof part.think === "string" && part.think) {
                  options.onUpdate?.({
                    sessionUpdate: "agent_thought_chunk",
                    content: { type: "text", text: part.think },
                  });
                } else if (part.type === "text" && typeof part.text === "string" && part.text) {
                  options.onUpdate?.({
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: part.text },
                  });
                }
              } else if (eventType === "tool.call") {
                const callId = asId(event.toolCallId);
                if (callId) {
                  toolTurns.set(callId, activeNotifyTurn);
                  const display = (event.display ?? {}) as Record<string, unknown>;
                  const title =
                    typeof display.description === "string" && display.description
                      ? display.description
                      : asId(event.name) || "tool";
                  options.onUpdate?.({
                    sessionUpdate: "tool_call",
                    toolCallId: `${activeNotifyTurn}:${callId}`,
                    title,
                    kind: inferToolKind(event.name),
                    status: "in_progress",
                    rawInput:
                      event.args && typeof event.args === "object"
                        ? (event.args as Record<string, unknown>)
                        : {},
                  });
                }
              } else if (eventType === "tool.result") {
                const callId = asId(event.toolCallId);
                const turnId = toolTurns.get(callId);
                if (callId && turnId === activeNotifyTurn) {
                  toolTurns.delete(callId);
                  const res = (event.result ?? {}) as Record<string, unknown>;
                  const text = toolResultText(res.output);
                  options.onUpdate?.({
                    sessionUpdate: "tool_call_update",
                    toolCallId: `${turnId}:${callId}`,
                    status: res.isError === true ? "failed" : "completed",
                    content: text ? [{ type: "content", content: { type: "text", text } }] : [],
                  });
                }
              }
              continue;
            }
            if (type === "turn.ended" && asId(record.turnId) === activeNotifyTurn) {
              activeNotifyTurn = undefined;
              endedNotify = true;
              if (record.reason === "failed") {
                const error = (record.error ?? {}) as { message?: unknown };
                return {
                  status: "failed",
                  error:
                    typeof error.message === "string" && error.message
                      ? error.message
                      : "Продолжение ответа Kimi завершилось с ошибкой",
                };
              }
            }
          }
        }

        const pendingIncoming = (options.incomingActivity?.().pending ?? 0) > 0;
        if (openBackground > 0 || activeNotifyTurn !== undefined || pendingIncoming) {
          idleSince = undefined;
        } else {
          idleSince ??= Date.now();
          const waited = Date.now() - idleSince;
          if (endedNotify && waited >= quietMs) return { status: "completed" };
          if (!started && waited >= startMs) return { status: "completed" };
        }

        if (Date.now() - startedAt >= totalMs) {
          return {
            status: "timeout",
            error: "Kimi не завершил продолжение после фоновой задачи",
          };
        }
        await pause(intervalMs, options.signal);
      }
    },
  };
}
