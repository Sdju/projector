// Who may touch a file on Windows, from `icacls`.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Principals in the file's ACL, e.g. ["RUNNER\\runneradmin"]. */
export async function aclPrincipals(path) {
  const { stdout } = await execute("icacls.exe", [path], { windowsHide: true });
  return stdout
    .split(/\r?\n/)
    .map((line) => /^\s*(?:.*?\.[^\s]*\s+)?(\S+):\(/.exec(line)?.[1])
    .filter(Boolean);
}
