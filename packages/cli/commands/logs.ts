import { serverLogPath } from "@projector-ai/core/modules/app-paths/index.ts";
import { writeJson, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";

export function commandLogs(options: CliOptions, out: Output): string {
  const path = serverLogPath();
  if (options.json) writeJson(out, { path });
  else if (!options.quiet) out(path);
  return path;
}
