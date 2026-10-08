import { expect, onTestFinished, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askpassHelper } from "../server/modules/git-import/clone.ts";
import { expandPath } from "../server/modules/projects/index.ts";
import { hotkeys } from "../core/modules/os/modules/windows/shortcut.ts";
import { startDesktopShell } from "../core/modules/os/modules/windows/shell.ts";

const credentials = { username: "x-access-token", tokenEnv: "PROJECTOR_GITHUB_TOKEN", failure: "" };
const handlers = () => ({
  onActivate() {},
  onHotkey() {},
  onSettings() {},
  onRestart() {},
  onQuit() {},
});

/** Stands in for the PowerShell host: same line protocol, scripted replies. */
function fakeHost(script) {
  return () =>
    spawn(
      process.execPath,
      [
        "-e",
        `const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (line) => process.stdout.write(line + "\\n");
${script}
send("ready");
rl.on("line", (line) => { const p = line.split(" "); if (p[0] === "hotkey") reply(p); if (line === "quit") process.exit(0); });`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
}

async function shellWith(script, timeout) {
  const data = await mkdtemp(join(tmpdir(), "projector-shell-"));
  const shell = await startDesktopShell(data, handlers(), fakeHost(script), timeout);
  onTestFinished(async () => {
    await shell.stop();
    await rm(data, { recursive: true, force: true });
  });
  return { shell, data };
}

test("Windows hotkey table has no Win+Space and agrees with RegisterHotKey flags", () => {
  expect(hotkeys["Super+Space"]).toBeUndefined();
  for (const spec of Object.values(hotkeys)) {
    expect(spec.mod & 0x4000).toBe(0x4000);
    expect(spec.vk).toBe(0x20);
  }
});

test("shell sends the hotkey spec from the table and records the state", async () => {
  const { shell, data } = await shellWith(
    `global.reply = (p) => send("result " + p[1] + (p[2] === "clear" ? " cleared" : p[2] === "16387" && p[3] === "32" ? " registered" : " busy"));`,
  );
  expect(await shell.configure("Ctrl+Alt+Space")).toBe("registered");
  expect(JSON.parse(await readFile(join(data, "hotkey.json"), "utf8"))).toEqual({
    shortcut: "Ctrl+Alt+Space",
    active: true,
  });
  expect(await shell.configure("Alt+Space")).toBe("busy");
  expect(await shell.configure("Super+Space")).toBe("busy");
  expect(await shell.configure("")).toBe("cleared");
  expect(JSON.parse(await readFile(join(data, "hotkey.json"), "utf8")).active).toBe(false);
});

test("a late reply is not taken for the answer to the next request", async () => {
  const { shell, data } = await shellWith(
    `global.reply = (p) => {
  if (p[1] === "1") setTimeout(() => send("result 1 registered"), 300);
  else send("result " + p[1] + " busy");
};`,
    100,
  );
  expect(await shell.configure("Ctrl+Alt+Space")).toBe("busy");
  expect(await shell.configure("Alt+Space")).toBe("busy");
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(JSON.parse(await readFile(join(data, "hotkey.json"), "utf8")).active).toBe(false);
});

test("askpass helper keeps shell metacharacters out of the script", () => {
  const windows = askpassHelper(credentials, "win32");
  expect(windows.filename).toBe("askpass.cmd");
  expect(windows.contents).toContain("\r\n");
  expect(windows.contents).toContain("!PROJECTOR_GITHUB_TOKEN!");
  expect(askpassHelper(credentials, "linux").filename).toBe("askpass");
  for (const platform of ["win32", "linux"]) {
    expect(() => askpassHelper({ ...credentials, username: 'a"&calc' }, platform)).toThrow();
    expect(() => askpassHelper({ ...credentials, tokenEnv: "X%Y" }, platform)).toThrow();
  }
});

test("expandPath understands both home shortcuts", () => {
  expect(expandPath("~\\work")).toBe(expandPath("~/work"));
});
