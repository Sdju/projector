// Runs the real Win32 adapter. Skipped elsewhere: the protocol and script tests cover other hosts.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import { os } from "../core/modules/os/index.ts";

const windows = process.platform === "win32";
const scratch = async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-win-adapter-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true, maxRetries: 10 }));
  return directory;
};

test.skipIf(!windows)(
  "process listing, identity, descendants and cwd see a real child",
  async () => {
    const directory = await scratch();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      cwd: directory,
      stdio: "ignore",
    });
    onTestFinished(() => child.kill());
    const listed = await os.processes.list();
    expect(listed?.some((entry) => entry.pid === child.pid)).toBe(true);
    const identity = await os.processes.identity(child.pid);
    expect(identity).toMatch(/^\d+$/);
    expect(await os.processes.identity(child.pid)).toBe(identity);
    expect(
      (await os.processes.descendants(process.pid)).some((entry) => entry.pid === child.pid),
    ).toBe(true);
    expect((await os.processes.workingDirectory(child.pid, "fallback")).toLowerCase()).toBe(
      directory.toLowerCase(),
    );
    child.kill();
    await os.processes.waitForExit(child.pid, 5000);
    expect(await os.processes.identity(child.pid)).toBe(null);
  },
);

test.skipIf(!windows)("console host helpers never appear as user processes", async () => {
  const names = ((await os.processes.list()) ?? []).map((entry) => entry.name);
  expect(names).not.toContain("conhost");
  expect(names).not.toContain("openconsole");
});

test.skipIf(!windows)(
  "moveNoReplace moves files and directories and never overwrites",
  async () => {
    const directory = await scratch();
    await writeFile(join(directory, "a.txt"), "a");
    await os.tools.moveNoReplace(join(directory, "a.txt"), join(directory, "b.txt"));
    expect(await readFile(join(directory, "b.txt"), "utf8")).toBe("a");
    await writeFile(join(directory, "c.txt"), "c");
    await os.tools.moveNoReplace(join(directory, "c.txt"), join(directory, "b.txt"));
    expect(await readFile(join(directory, "b.txt"), "utf8")).toBe("a");
    expect(await readFile(join(directory, "c.txt"), "utf8")).toBe("c");
    await mkdir(join(directory, "dir"));
    await os.tools.moveNoReplace(join(directory, "dir"), join(directory, "moved"));
    await expect(readFile(join(directory, "moved", "x"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test.skipIf(!windows)(
  "publishDirectory claims a free name and reports an existing one",
  async () => {
    const directory = await scratch();
    await mkdir(join(directory, "checkout"));
    await writeFile(join(directory, "checkout", "f"), "1");
    await os.tools.publishDirectory(join(directory, "checkout"), join(directory, "project"));
    expect(await readFile(join(directory, "project", "f"), "utf8")).toBe("1");
    await mkdir(join(directory, "second"));
    await expect(
      os.tools.publishDirectory(join(directory, "second"), join(directory, "project")),
    ).rejects.toMatchObject({ code: "EEXIST" });
  },
);

test.skipIf(!windows)(
  "Credential Manager round-trips Unicode and passes values off the command line",
  async () => {
    if (!(await os.secrets.available())) return;
    const key = { service: "projector-test", account: `adapter-${process.pid}` };
    onTestFinished(() => os.secrets.delete(key));
    const value = 'токен "с кавычками" & %PATH% ^ 日本語';
    await os.secrets.set(key, "Projector adapter test", value);
    expect(await os.secrets.get(key)).toBe(value);
    await os.secrets.delete(key);
    expect(await os.secrets.get(key)).toBeUndefined();
  },
);

test.skipIf(!windows)("window operations leave the event loop responsive", async () => {
  let worst = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    worst = Math.max(worst, Date.now() - last - 20);
    last = Date.now();
  }, 20);
  try {
    expect(await os.windows.focusApp("projector-no-such-window")).toBe(false);
    await os.windows.closePalette("projector-no-such-window");
  } finally {
    clearInterval(timer);
  }
  expect(worst).toBeLessThan(400);
});

test.skipIf(!windows)("only http(s) addresses are opened with the default browser", () => {
  expect(() => os.windows.openBrowser("file:///C:/Windows/System32/calc.exe")).toThrow(/http/);
  expect(() => os.windows.openBrowser('" ; calc ; "')).toThrow(/http/);
});

test.skipIf(!windows)("shell launch uses a real shell and bash -c runs a script", async () => {
  const launch = os.shellLaunch({ kind: "command", command: "echo hello" });
  expect(launch.file.toLowerCase()).toMatch(/bash\.exe$|powershell\.exe$|pwsh\.exe$/);
  const directory = await scratch();
  const result = await os.tools.runBash("echo hello", { cwd: directory });
  expect(result.stdout.trim()).toBe("hello");
  expect(result.exitCode).toBe(0);
});

test.skipIf(!windows)("agent process trees are terminated as a whole", async () => {
  const child = os.tools.spawnAgentProcess({
    command: process.execPath,
    args: [
      "-e",
      "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit'});setTimeout(()=>{},60000)",
    ],
    env: process.env,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const before = (await os.processes.descendants(child.pid)).length;
  expect(before).toBeGreaterThanOrEqual(2);
  await child.terminate();
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(
    (await os.processes.descendants(child.pid)).filter((entry) => entry.pid !== child.pid).length,
  ).toBe(0);
});

test.skipIf(!windows)("polling the process snapshot never waits", async () => {
  await os.processes.list();
  const started = Date.now();
  for (let i = 0; i < 200; i++) os.processes.snapshot();
  expect(Date.now() - started).toBeLessThan(100);
  const [first] = os.processes.snapshot() ?? [];
  expect(first.group).toBe(null);
  expect(first.foreground).toBe(null);
});

test.skipIf(!windows)(
  "agent launch quotes paths with spaces and metacharacters for cmd.exe",
  () => {
    const launch = os.tools.agentLaunch({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["plain", "with space", 'q"uote', "a&b", ""],
    });
    expect(launch.shell).toBe(true);
    expect(launch.command).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(launch.args).toStrictEqual(["plain", '"with space"', '"q\\"uote"', '"a&b"', '""']);
  },
);

test.skipIf(!windows)(
  "a Job Object ends an agent's whole tree when its owner goes away",
  async () => {
    const { bindTreeToJob, closeJob, warmJob } =
      await import("../core/modules/os/modules/windows/job.ts");
    expect(await warmJob()).toBe(true);
    const script =
      "const {spawn}=require('child_process');setTimeout(()=>{const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log('GRANDCHILD '+c.pid)},1500);setTimeout(()=>{},60000)";
    const child = os.tools.spawnAgentProcess({
      command: process.execPath,
      args: ["-e", script],
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    expect(await bindTreeToJob(child.pid)).toBe(true);
    for (let i = 0; i < 100 && !output.includes("GRANDCHILD"); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    const grandchild = Number(/GRANDCHILD (\d+)/.exec(output)?.[1]);
    expect(grandchild).toBeGreaterThan(0);
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(child.pid) && alive(grandchild)).toBe(true);
    closeJob(); // what a crashing server does implicitly: the helper's handle to the job closes
    for (let i = 0; i < 50 && (alive(child.pid) || alive(grandchild)); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(child.pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  },
);
