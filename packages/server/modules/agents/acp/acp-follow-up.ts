import type { AgentEmitter, AgentRunOptions } from "../../agent/index.ts";
import type { AcpProgram, AcpFollowUp, AcpFollowUpOptions } from "./acp-programs.ts";
import { markAcpKeepAlive } from "./acp-keep-alive.ts";

/** The part of an ACP answer the end of a run reads. */
export interface AcpAnswer {
  finish(): void;
  waitBackground(signal?: AbortSignal): Promise<void>;
  pollBackground(): number;
  readonly text: string;
  readonly pendingBackground: number;
  readonly keepsProcess: boolean;
  /** The answer held background work that can wake the agent into another step. */
  readonly hadBackground: boolean;
}

export interface AcpSettleOptions {
  answer: AcpAnswer;
  program: AcpProgram;
  followUp?: AcpFollowUp;
  disconnected?: AbortSignal;
  incomingActivity?: AcpFollowUpOptions["incomingActivity"];
  options: Pick<AgentRunOptions, "abort" | "run" | "emit">;
}

/** Keep one live run until the answer and tracked background work settle. */
export async function settleAcpAnswer(options: AcpSettleOptions): Promise<boolean> {
  const { answer, program } = options;
  const { abort, run } = options.options;
  const emit: AgentEmitter = options.options.emit;
  const signal = AbortSignal.any(
    [abort, options.disconnected].filter((value): value is AbortSignal => !!value),
  );
  answer.finish();
  const followUp = answer.hadBackground ? options.followUp : undefined;
  if (!followUp) {
    const done = () => emit("done", { text: answer.text.trim(), added: [] });
    if (!program.finishAfterBackground) done();
    // A server restart may detach the host after end_turn, before the background wait finishes.
    if (program.finishAfterBackground && answer.pendingBackground && run)
      await markAcpKeepAlive(run.id);
    if (answer.pendingBackground)
      emit("status", { phase: "background", provider: program.label, model: "" });
    await answer.waitBackground(signal);
    if (abort?.aborted) return false;
    if (answer.pendingBackground) options.disconnected?.throwIfAborted();
    if (program.finishAfterBackground) done();
    if (run && answer.keepsProcess) await markAcpKeepAlive(run.id);
    return answer.keepsProcess;
  }
  // Install the fallback before waiting: a lost observer must not SIGTERM an active child.
  // Failure is visible, but must not change the decision to preserve the process.
  try {
    if (run) await markAcpKeepAlive(run.id);
  } catch {
    emit("error", { error: "Не удалось сохранить процесс агента при отключении" });
    return true;
  }
  if (answer.pendingBackground)
    emit("status", { phase: "background", provider: program.label, model: "" });
  const result = await followUp.wait({
    signal,
    pending: () => answer.pollBackground(),
    incomingActivity: options.incomingActivity,
    onStart: () => {
      if (!abort?.aborted)
        emit("status", { phase: "thinking", provider: program.label, model: "" });
    },
  });
  if (abort?.aborted) return true;
  if (options.disconnected?.aborted)
    emit("error", { error: "Потеряно ACP-соединение во время продолжения ответа" });
  else if ("error" in result) emit("error", { error: result.error });
  else if (result.status !== "aborted") {
    answer.finish();
    emit("done", {
      text: answer.text.trim(),
      added: [],
      ...(result.status === "superseded" ? { stopped: true } : {}),
    });
  }
  return true;
}
