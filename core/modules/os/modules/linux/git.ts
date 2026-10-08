import { mkdir, rename, rmdir } from "node:fs/promises";
import type { AskpassScript, AskpassSpec } from "../../contract.ts";

export function gitAskpass({ username, tokenEnv }: AskpassSpec): AskpassScript {
  if (!/^[\w.-]+$/.test(username) || !/^[A-Za-z_]\w*$/.test(tokenEnv))
    throw new Error("Недопустимые параметры askpass");
  return {
    filename: "askpass",
    contents: `#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "${username}" ;; *) printf "%s\\n" "$${tokenEnv}" ;; esac\n`,
  };
}

/** POSIX rename replaces an empty directory, so the destination is claimed with mkdir first. */
export async function publishDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination);
  try {
    await rename(source, destination);
  } catch (error) {
    await rmdir(destination).catch(() => {});
    throw error;
  }
}

/** The socket lives outside the run directory when the directory is too deep for a socket path. */
export async function removeAgentHostAddress(dir: string, address: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  if (!address.startsWith(dir)) await rm(address, { force: true });
}
