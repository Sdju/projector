import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vite-plus/test";
import { clearInstance, writeInstance } from "../server/modules/instance/index.ts";
import { instancePath } from "../core/modules/app-paths/index.ts";

test("exit cleanup finishes synchronously and preserves a replacement server's instance", async () => {
  await writeInstance(4321);
  const file = instancePath();
  const replacement = JSON.stringify({ pid: process.pid + 1, port: 4322 });
  await writeFile(file, replacement);
  clearInstance();
  expect(await readFile(file, "utf8")).toBe(replacement);
  await writeInstance(4321);
  clearInstance();
  expect(existsSync(file)).toBe(false);

  const data = await mkdtemp(join(tmpdir(), "projector-exit-"));
  onTestFinished(() => rm(data, { recursive: true, force: true }));
  const module = new URL("../server/modules/instance/index.ts", import.meta.url).href;
  await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { clearInstance, writeInstance } from ${JSON.stringify(module)};
    process.on("exit", clearInstance);
    await writeInstance(4321);
  `,
    ],
    { env: { ...process.env, XDG_DATA_HOME: data } },
  );
  expect(existsSync(join(data, "projector", "instance.json"))).toBe(false);
});
