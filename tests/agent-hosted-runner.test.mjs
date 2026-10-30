import { expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../server/modules/agent/hosted-runner.ts", import.meta.url));

// The host stops a run by signalling the whole group and then the runner once more: the answer
// must see `abort` and end what it started, not be killed by the second signal.
test(
  "a stopped hosted run aborts its answer even when SIGTERM arrives twice",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "projector-runner-"));
    try {
      await writeFile(
        join(dir, "run.json"),
        JSON.stringify({ backend: "projector", message: "m", history: [] }),
      );
      await writeFile(
        join(dir, "run.mjs"),
        `import { runHostedRunner } from ${JSON.stringify(RUNNER)};
runHostedRunner(async (options) => {
  options.emit("text", { text: "started" });
  await new Promise((resolve) => options.abort.addEventListener("abort", resolve));
  await new Promise((resolve) => setTimeout(resolve, 100));
  options.emit("text", { text: "cleaned" });
});`,
      );
      const child = spawn(process.execPath, [join(dir, "run.mjs"), dir], {
        stdio: ["pipe", "pipe", "inherit"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      const closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
      const until = async (check) => {
        for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
      };
      await until(() => output.includes("started"));
      child.kill("SIGTERM");
      child.kill("SIGTERM");
      expect(await closed).toBe(0);
      expect(output).toContain("cleaned");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
