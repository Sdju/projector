import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export function moveNoReplace(source: string, target: string) {
  return execute("mv", [
    "--no-clobber",
    "--no-target-directory",
    "--no-copy",
    "--",
    source,
    target,
  ]);
}
export function runPython(
  helper: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) {
  return execute("python3", ["-I", helper, ...args], {
    ...options,
    env: { ...process.env, PYTHONNOUSERSITE: "1" },
  });
}
export function searchFiles(
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) {
  return execute("rg", args, options);
}
