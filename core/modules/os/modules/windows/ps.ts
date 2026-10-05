import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function decodeOutput(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return buffer.subarray(3).toString("utf8");
  const sample = buffer.subarray(0, Math.min(buffer.length, 64));
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros++;
  if (sample.length > 0 && zeros > sample.length / 4)
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  return buffer.toString("utf8");
}

function script(body: string): string[] {
  const encoded = Buffer.from(
    [
      "$ProgressPreference = 'SilentlyContinue'",
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
      body,
    ].join("\n"),
    "utf16le",
  ).toString("base64");
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded];
}

export function runPowerShell(
  body: string,
  options: {
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    maxBuffer?: number;
    sta?: boolean;
  } = {},
) {
  const args = script(body);
  if (options.sta) args.unshift("-STA");
  return execute("powershell.exe", args, {
    timeout: options.timeout ?? 15000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    windowsHide: true,
    encoding: "buffer",
    env: options.env ? { ...process.env, ...options.env } : process.env,
  }).then(({ stdout, stderr }) => ({
    stdout: decodeOutput(stdout as unknown as Buffer),
    stderr: decodeOutput(stderr as unknown as Buffer),
  }));
}

export function runPowerShellSync(
  body: string,
  options: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): string {
  const stdout = execFileSync("powershell.exe", script(body), {
    timeout: options.timeout ?? 15000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    encoding: "buffer",
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  return decodeOutput(stdout as unknown as Buffer);
}
