import { expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("../modules/agent/hosted-runner.ts", import.meta.url));

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

// A damaged record must stop the run loudly: the runner would otherwise continue an answer
// without its settings, and the server would overwrite the evidence on its next write.
test(
  "a hosted run with a damaged run record fails and keeps the file aside",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "projector-runner-broken-"));
    try {
      await writeFile(join(dir, "run.json"), "{ broken");
      await writeFile(
        join(dir, "run.mjs"),
        `import { runHostedRunner } from ${JSON.stringify(RUNNER)};
runHostedRunner(async () => { throw new Error("the answer must not start"); });`,
      );
      const child = spawn(process.execPath, [join(dir, "run.mjs"), dir], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (errors += chunk));
      const closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
      expect(await closed).toBe(1);
      expect(output).toContain('"event":"error"');
      expect(output).toContain("непригоден");
      expect(errors).toContain("повреждён");
      expect((await readdir(dir)).some((name) => name.startsWith("run.json.broken-"))).toBe(true);
      await expect(readFile(join(dir, "run.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
