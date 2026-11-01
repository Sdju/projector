import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test(
  "Environment API reloads preserve PTY, SSE and live control handlers; failed loads keep the working API",
  { skip: process.platform === "win32", timeout: 120_000 },
  async () => {
    // A separate process owns real Vite environments and native PTYs, independent of Vitest's runner.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/environment-runtime.mjs", import.meta.url))],
      { timeout: 110_000, maxBuffer: 1024 * 1024 },
    );
    expect(stdout).toContain("environment runtime passed");
  },
);
