import { chmodSync } from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { SpawnProcessSpec } from "./contract.ts";

const execute = promisify(execFile);
/** Starts a caller-defined process with the stdio it asked for; no shell unless requested. */
export function spawnProcess(spec: SpawnProcessSpec) {
  return spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env as NodeJS.ProcessEnv | undefined,
    stdio: spec.stdio,
    shell: spec.shell === true,
  });
}
export function commandExists(bin: string, env?: Record<string, string | undefined>): boolean {
  try {
    execFileSync("which", [bin], {
      stdio: "ignore",
      env: (env ?? process.env) as NodeJS.ProcessEnv,
    });
    return true;
  } catch {
    return false;
  }
}
/** Argument-vector Docker transport; never invoke a shell or inherit a host override. */
export function runDocker(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    onOutput?: BashOutput;
  } = {},
) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key)) delete env[key];
  if (options.onOutput)
    return runStreamingProcess("docker", args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 15000,
      signal: options.signal,
      env,
      onOutput: options.onOutput,
    });
  return execute("docker", args, {
    cwd: options.cwd,
    timeout: options.timeout ?? 15000,
    signal: options.signal,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
}
/** Runs a Node script with this server's Node; no shell, no secrets from the host environment. */
export function runNodeScript(
  script: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    onOutput?: BashOutput;
  } = {},
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
        !/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key),
    ),
  );
  if (options.onOutput)
    return runStreamingProcess(process.execPath, [script, ...args], {
      cwd: options.cwd,
      timeout: options.timeout ?? 30000,
      signal: options.signal,
      env,
      onOutput: options.onOutput,
    });
  return execute(process.execPath, [script, ...args], {
    cwd: options.cwd,
    timeout: options.timeout ?? 30000,
    signal: options.signal,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
}

/**
 * The streaming shape of `execFile`: same `{ stdout, stderr }` result and the same rejection
 * (`code`, `stdout`, `stderr`) for a failed or timed-out process, but output is also reported as
 * it arrives. Used for commands whose progress the chat shows live.
 */
export function runStreamingProcess(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    signal?: AbortSignal;
    maxBuffer?: number;
    onOutput?: BashOutput;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const limit = options.maxBuffer ?? 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("Запрос остановлен"));
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const stop = (reason: Error) => {
      failure ??= reason;
      try {
        child.kill();
      } catch {
        /* Already gone. */
      }
    };
    const capture = (target: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      const available = limit - bytes;
      if (available > 0) target.push(chunk.subarray(0, available));
      bytes += chunk.length;
      if (bytes > limit) {
        const error = Object.assign(new Error("Вывод команды превысил лимит"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
        stop(error);
      } else options.onOutput?.(chunk.toString("utf8"), stream);
    };
    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk, "stderr"));
    const timer =
      options.timeout === undefined
        ? undefined
        : setTimeout(() => {
            const error = Object.assign(new Error("Команда не завершилась вовремя"), {
              killed: true,
              code: null,
            });
            stop(error);
          }, options.timeout);
    const abort = () => {
      if (options.signal?.aborted) stop(new Error("Запрос остановлен"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (failure)
        return reject(
          Object.assign(failure, {
            code: (failure as { code?: unknown }).code ?? null,
            stdout: out,
            stderr: err,
          }),
        );
      if (code === 0) return resolve({ stdout: out, stderr: err });
      reject(
        Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}`), {
          code,
          stdout: out,
          stderr: err,
        }),
      );
    });
  });
}
export function runDockerSync(args: string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key)) delete env[key];
  return execFileSync("docker", args, { env, timeout: 5000, stdio: "ignore" });
}
/** Streamed output of a command, as it arrives: `stdout` or `stderr`, decoded as UTF-8. */
export type BashOutput = (chunk: string, stream: "stdout" | "stderr") => void;

export function runBash(
  command: string,
  options: { cwd: string; signal?: AbortSignal; onOutput?: BashOutput },
) {
  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    terminated?: boolean;
  }>((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("Запрос остановлен"));
    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", command], {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key),
        ),
      ),
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      terminated = false;
    const kill = () => {
      terminated = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    };
    const capture = (target: Buffer[], chunk: Buffer) => {
      const available = 256 * 1024 - bytes;
      if (available > 0) target.push(chunk.subarray(0, available));
      bytes += chunk.length;
      if (bytes > 256 * 1024) kill();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      capture(stdout, chunk);
      options.onOutput?.(chunk.toString("utf8"), "stdout");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture(stderr, chunk);
      options.onOutput?.(chunk.toString("utf8"), "stderr");
    });
    const timer = setTimeout(kill, 30000);
    options.signal?.addEventListener("abort", kill, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (exitCode) => {
      cleanup();
      // Background descendants must not outlive an agent tool call.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
      if (options.signal?.aborted) return reject(new Error("Запрос остановлен"));
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        terminated,
      });
    });
  });
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

/** POSIX resolves a bare name itself. */
export function ptyCommand(file: string, args: string[]): { file: string; args: string[] } {
  return { file, args };
}

/** POSIX: any execute bit. */
export function isExecutableFile(_name: string, mode: number): boolean {
  return !!(mode & 0o111);
}

/** 0600: readable and writable by the owner only. */
export async function restrictToOwner(path: string): Promise<void> {
  const { chmod } = await import("node:fs/promises");
  await chmod(path, 0o600);
}
export function restrictToOwnerSync(path: string): void {
  chmodSync(path, 0o600);
}
