import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
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
  options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key)) delete env[key];
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
  options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
        !/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key),
    ),
  );
  return execute(process.execPath, [script, ...args], {
    cwd: options.cwd,
    timeout: options.timeout ?? 30000,
    signal: options.signal,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
}
export function runDockerSync(args: string[]) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key)) delete env[key];
  return execFileSync("docker", args, { env, timeout: 5000, stdio: "ignore" });
}
export function runBash(command: string, options: { cwd: string; signal?: AbortSignal }) {
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
    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
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
