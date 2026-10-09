import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export {
  runDocker,
  runDockerSync,
  runNodeScript,
  runBash,
  commandExists,
  ptyCommand,
  isExecutableFile,
  restrictToOwner,
  restrictToOwnerSync,
  runPython,
  searchFiles,
} from "../../../os-posix/index.ts";

/** BSD `mv -n` leaves an existing destination alone and, like GNU, may exit 0 without moving. */
export function moveNoReplace(source: string, target: string) {
  return execute("mv", ["-n", "--", source, target]);
}
