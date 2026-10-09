import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export * from "../../../os-posix/index.ts";

export function moveNoReplace(source: string, target: string) {
  return execute("mv", [
    "--update=none",
    "--no-target-directory",
    "--no-copy",
    "--",
    source,
    target,
  ]);
}
