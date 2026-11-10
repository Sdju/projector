import { extendPlainDialect, type AcpDialect, type AcpUpdate } from "../acp/index.ts";
import { stripReadLineNumbers } from "@ai-projector/core/modules/agent-read/index.ts";

/** A call that reads a file: its result is a numbered file body, not raw tool text. */
const readsFile = (update: AcpUpdate) =>
  update.kind === "read" || (typeof update.title === "string" && /^Reading\b/i.test(update.title));

/** Kimi Code adds no subagents or background commands, only numbered file reads. */
export function createKimiDialect(): AcpDialect {
  const reads = new Set<string>();
  return extendPlainDialect({
    call(update, id) {
      if (readsFile(update)) reads.add(id);
      return [];
    },
    result(_update, id, output) {
      return reads.has(id) ? stripReadLineNumbers(output) : output;
    },
  });
}
