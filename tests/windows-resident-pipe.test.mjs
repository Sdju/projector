import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processIdentity } from "../core/modules/os/modules/windows/processes.ts";
import { killTree } from "../core/modules/os/modules/windows/kill-tree.ts";
import {
  bindPipe,
  forward,
  launcherIdentityPath,
  launcherPidPath,
  launcherTokenPath,
  reclaim,
  waitForForward,
} from "../core/modules/os/modules/windows/resident-pipe.ts";

vi.mock("../core/modules/os/modules/windows/processes.ts", () => ({ processIdentity: vi.fn() }));
vi.mock("../core/modules/os/modules/windows/kill-tree.ts", () => ({ killTree: vi.fn() }));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "projector-resident-pipe-"));
  const previous = process.env.PROJECTOR_LAUNCHER_PIPE;
  process.env.PROJECTOR_LAUNCHER_PIPE =
    process.platform === "win32"
      ? `\\\\.\\pipe\\projector-test-${randomUUID()}`
      : join(directory, "resident.sock");
  vi.mocked(processIdentity).mockReset();
  vi.mocked(killTree).mockReset();
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.PROJECTOR_LAUNCHER_PIPE;
    else process.env.PROJECTOR_LAUNCHER_PIPE = previous;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test.each([
  ["legacy PID without identity", null, "current", false],
  ["reused PID", { pid: 12345, started: "old" }, "current", false],
  ["different PID in identity", { pid: 54321, started: "current" }, "current", false],
  ["process no longer exists", { pid: 12345, started: "old" }, null, false],
  ["matching resident identity", { pid: 12345, started: "current" }, "current", true],
])("reclaim handles %s safely", async (_name, identity, current, shouldKill) => {
  const directory = await fixture();
  await writeFile(launcherPidPath(directory), "12345\n");
  await writeFile(launcherTokenPath(directory), "secret\n");
  if (identity) await writeFile(launcherIdentityPath(directory), JSON.stringify(identity));
  vi.mocked(processIdentity).mockResolvedValue(current);
  await reclaim(directory);
  if (shouldKill) expect(killTree).toHaveBeenCalledExactlyOnceWith(12345);
  else expect(killTree).not.toHaveBeenCalled();
  for (const file of [launcherPidPath, launcherTokenPath, launcherIdentityPath])
    await expect(readFile(file(directory))).rejects.toMatchObject({ code: "ENOENT" });
});

test("a command retried while startup is pending executes once, including after READY", async () => {
  const directory = await fixture();
  await writeFile(launcherPidPath(directory), `${process.pid}\n`);
  await writeFile(launcherTokenPath(directory), "secret\n");
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const dispatch = vi.fn(async () => {
    await ready;
  });
  const server = await bindPipe("secret", dispatch);
  onTestFinished(() => {
    release();
    server.close();
  });
  const requestId = randomUUID();
  // This connection times out, but the resident keeps its pending command.
  expect(await forward("toggle", directory, requestId)).toBe(false);
  const retried = waitForForward("toggle", directory, 3, requestId);
  release();
  expect(await retried).toBe(true);
  expect(await forward("toggle", directory, requestId)).toBe(true);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("toggle");
  // A separate user action still executes, even with the same command name.
  expect(await forward("toggle", directory)).toBe(true);
  expect(dispatch).toHaveBeenCalledTimes(2);
});

test("a rejected command does not hang a forwarding client", async () => {
  const directory = await fixture();
  await writeFile(launcherTokenPath(directory), "wrong-token\n");
  const dispatch = vi.fn();
  const server = await bindPipe("secret", dispatch);
  onTestFinished(() => server.close());
  expect(await forward("toggle", directory)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
