import { expect, onTestFinished, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOs } from "../core/modules/os/index.ts";
import { expandPath } from "../server/modules/projects/index.ts";
import { hotkeys } from "../core/modules/os/modules/windows/shortcut.ts";
import {
  parseAppsUseLightTheme,
  readWindowsColorScheme,
} from "../core/modules/os/modules/windows/color-scheme.ts";
import { startDesktopShell } from "../core/modules/os/modules/windows/shell.ts";
import {
  closeWindow,
  foregroundWindow,
  hideWindow,
  placeWindow,
  setWindowHostSpawn,
  showWindow,
  stopWindowHost,
  windowCall,
  windowHostPid,
} from "../core/modules/os/modules/windows/hwnd.ts";

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

test("a colors line from the tray host reports a Windows color-scheme change", async () => {
  let colors = 0;
  const data = await mkdtemp(join(tmpdir(), "projector-shell-"));
  const shell = await startDesktopShell(
    data,
    { ...handlers(), onColorScheme: () => colors++ },
    fakeHost(`setTimeout(() => send("colors"), 30); global.reply = () => {};`),
  );
  onTestFinished(async () => {
    await shell.stop();
    await rm(data, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 20 && colors === 0; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  expect(colors).toBe(1);
});

test("AppsUseLightTheme dword 0 is the dark Windows app mode", () => {
  expect(
    parseAppsUseLightTheme(
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    0x0\r\n",
    ),
  ).toBe("dark");
  expect(parseAppsUseLightTheme("    AppsUseLightTheme    REG_DWORD    0x1")).toBe("light");
  expect(parseAppsUseLightTheme("    AppsUseLightTheme    REG_DWORD    0x00000000")).toBe("dark");
  expect(parseAppsUseLightTheme("ERROR")).toBeUndefined();
});

test.skipIf(process.platform !== "win32")("the live Windows app mode is readable", async () => {
  expect(await readWindowsColorScheme()).toMatch(/^(dark|light)$/);
});

test("askpass helper keeps shell metacharacters out of the script", () => {
  const windows = createOs("win32").tools.gitAskpass(credentials);
  expect(windows.filename).toBe("askpass.cmd");
  expect(windows.contents).toContain("\r\n");
  expect(windows.contents).toContain("!PROJECTOR_GITHUB_TOKEN!");
  expect(createOs("linux").tools.gitAskpass(credentials).filename).toBe("askpass");
  for (const platform of ["win32", "linux"]) {
    expect(() =>
      createOs(platform).tools.gitAskpass({ ...credentials, username: 'a"&calc' }),
    ).toThrow();
    expect(() =>
      createOs(platform).tools.gitAskpass({ ...credentials, tokenEnv: "X%Y" }),
    ).toThrow();
  }
});

test("expandPath understands both home shortcuts", () => {
  expect(expandPath("~\\work")).toBe(expandPath("~/work"));
});

function windowFake(body) {
  return () => spawn(process.execPath, ["-e", body], { stdio: ["pipe", "pipe", "pipe"] });
}

async function restoreWindowHost() {
  setWindowHostSpawn(null);
  await stopWindowHost();
}

test("a window helper that exits before ready is replaced, and stderr cannot stall it", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
  };
  setWindowHostSpawn(windowFake("process.exit(1)"));
  onTestFinished(async () => {
    console.error = original;
    await restoreWindowHost();
  });
  const stalled = await Promise.race([
    placeWindow("42"),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 2000)),
  ]);
  expect(stalled).toBe("");
  expect(errors.join("\n")).toContain("window helper exited");

  setWindowHostSpawn(
    windowFake(`
      const fs = require("node:fs");
      const rl = require("node:readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        if (line.trim() === "quit") process.exit(0);
        const id = line.split(" ")[0];
        process.stdout.write("done " + id + " ok\\n");
      });
      const block = Buffer.alloc(64 * 1024, 101);
      for (let i = 0; i < 8; i++) fs.writeSync(2, block);
      process.stdout.write("ready\\n");
    `),
  );
  expect(await placeWindow("42")).toBe("ok");
  expect(errors.some((line) => line.includes("e".repeat(80)))).toBe(true);
});

test("show, place, hide and close ignore a value that is not an HWND", async () => {
  let spawned = 0;
  setWindowHostSpawn(() => {
    spawned += 1;
    return windowFake("process.exit(0)")();
  });
  onTestFinished(restoreWindowHost);
  expect(await showWindow("")).toBe("");
  expect(await showWindow("ProjectorLauncher")).toBe("");
  expect(await placeWindow("12px")).toBe("");
  expect(await hideWindow("0x10")).toBe("");
  expect(await closeWindow("-")).toBe("");
  expect(spawned).toBe(0);
});

test.skipIf(process.platform !== "win32")(
  "the window helper answers and stays up after a bad hwnd",
  async () => {
    onTestFinished(stopWindowHost);
    expect(await foregroundWindow("")).toMatch(/^\d+$/);
    const pid = windowHostPid();
    expect(pid).toBeGreaterThan(0);
    expect(await windowCall("show", "not-a-hwnd")).toBe("");
    expect(windowHostPid()).toBe(pid);
    expect(await foregroundWindow("")).toMatch(/^\d+$/);
  },
);
