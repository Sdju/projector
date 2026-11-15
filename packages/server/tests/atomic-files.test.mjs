import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { setAsideBroken, withFileLock, writeFileAtomic } from "../modules/atomic-files/index.ts";

let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-atomic-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a settings file is private, complete and leaves no temporary copy", async () => {
  const file = join(directory, "nested", "settings.json");
  await writeFileAtomic(file, '{"presets":[]}\n');
  expect(await readFile(file, "utf8")).toBe('{"presets":[]}\n');
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readdir(join(directory, "nested"))).toEqual(["settings.json"]);
});

test("the mode option keeps a file readable by others when it must be", async () => {
  const file = join(directory, "shared.json");
  await writeFileAtomic(file, "{}\n", { mode: 0o644 });
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o644);
});

test("a failed rename removes the temporary file", async () => {
  const target = join(directory, "target");
  await mkdir(target);
  await writeFile(join(target, "keep.txt"), "ok", "utf8");
  await expect(writeFileAtomic(target, "text")).rejects.toThrow();
  expect(await readdir(directory)).toEqual(["target"]);
  expect(await readdir(target)).toEqual(["keep.txt"]);
});

test("a damaged file is moved aside instead of being overwritten", async () => {
  const file = join(directory, "state.json");
  await writeFile(file, "{ broken", "utf8");
  const backup = await setAsideBroken(file);
  expect(backup.startsWith(`${file}.broken-`)).toBe(true);
  expect(await readFile(backup, "utf8")).toBe("{ broken");
  await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("tasks of one file run in order and a failure does not block the next", async () => {
  const file = join(directory, "queue.json");
  const order = [];
  const task = (name, delay, fail) => async () => {
    order.push(`start:${name}`);
    await pause(delay);
    order.push(`end:${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const first = withFileLock(file, task("a", 20));
  const failed = withFileLock(file, task("b", 1, true));
  const third = withFileLock(file, task("c", 1));
  await expect(failed).rejects.toThrow("b");
  expect(await first).toBe("a");
  expect(await third).toBe("c");
  expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
});

test("parallel writers under one lock keep every change", async () => {
  const file = join(directory, "list.json");
  await writeFile(file, "[]\n", "utf8");
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      withFileLock(file, async () => {
        const list = JSON.parse(await readFile(file, "utf8"));
        await pause(1);
        list.push(index);
        await writeFileAtomic(file, `${JSON.stringify(list)}\n`);
      }),
    ),
  );
  expect(JSON.parse(await readFile(file, "utf8"))).toHaveLength(20);
});
