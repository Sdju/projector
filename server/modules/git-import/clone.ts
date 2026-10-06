import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../http/index.ts";

const exec = promisify(execFile);

export interface HttpsCredentials {
  /** HTTPS user name the host expects together with the token. */
  username: string;
  /** Environment variable that carries the token to the askpass helper. */
  tokenEnv: string;
  /** Shown when `git clone` fails; never includes the token. */
  failure: string;
}

/** Hardened HTTPS clone: no hooks, no redirects, token only through a temporary askpass helper. */
export async function cloneOverHttps(
  url: string,
  destination: string,
  token: string,
  credentials: HttpsCredentials,
  signal?: AbortSignal,
) {
  const helper = await mkdtemp(join(tmpdir(), "projector-git-"));
  try {
    const askpass = join(helper, "askpass");
    await writeFile(
      askpass,
      `#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "${credentials.username}" ;; *) printf "%s\\n" "$${credentials.tokenEnv}" ;; esac\n`,
      { mode: 0o700 },
    );
    await exec(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "http.followRedirects=false",
        "clone",
        "--",
        url,
        destination,
      ],
      {
        env: {
          ...process.env,
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          [credentials.tokenEnv]: token,
        },
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(400, credentials.failure);
  } finally {
    await rm(helper, { recursive: true, force: true });
  }
}
