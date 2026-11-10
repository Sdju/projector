import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test(
  "Environment API reloads preserve PTY, SSE and live control handlers; failed loads keep the working API",
  { skip: process.platform === "win32", timeout: 240_000 },
  async () => {
    // A separate process owns real Vite environments and native PTYs, independent of Vitest's runner.
    // Reloads are slow on shared macOS runners, so the child gets a wide margin and reports progress.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../../../tests/fixtures/environment-runtime.mjs", import.meta.url))],
      { timeout: 220_000, maxBuffer: 1024 * 1024 },
    ).catch((error) => {
      throw new Error(`environment runtime failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
    });
    expect(stdout).toContain("environment runtime passed");
  },
);
