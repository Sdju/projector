import type { ShellLaunch } from "./contract.ts";

/** Linux container shell, independent of the host's OS and preferred shell. */
export function bashShellLaunch(spec: ShellLaunch, clean = false) {
  const args = clean ? ["--noprofile", "--norc"] : [];
  if (spec.kind === "command") args.push("-c", spec.command);
  else if (spec.kind === "program") args.push("-i", "-c", `exec ${spec.executable}`);
  else args.push("-i");
  return { file: "/bin/bash", args };
}
