// Desktop pieces that only exist on Windows: the Start Menu catalog and a real GTK window.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vite-plus/test";
import { os } from "../core/modules/os/index.ts";
import { runPowerShell } from "../core/modules/os/modules/windows/ps.ts";

const windows = process.platform === "win32";
const execute = promisify(execFile);

test.skipIf(!windows)("Start Menu catalog lists, launches and resolves shortcuts", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-startmenu-"));
  const previous = { appdata: process.env.APPDATA, programdata: process.env.ProgramData };
  onTestFinished(async () => {
    process.env.APPDATA = previous.appdata;
    process.env.ProgramData = previous.programdata;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const programs = join(root, "roaming", "Microsoft", "Windows", "Start Menu", "Programs");
  await mkdir(programs, { recursive: true });
  await mkdir(join(root, "common"), { recursive: true });
  process.env.APPDATA = join(root, "roaming");
  process.env.ProgramData = join(root, "common");
  const marker = join(root, "launched.txt");
  const script = join(root, "probe.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "started");`,
  );
  await runPowerShell(
    `
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($env:LINK)
$link.TargetPath = $env:NODE
$link.Arguments = '"' + $env:SCRIPT + '"'
$link.Save()
`,
    {
      env: { LINK: join(programs, "Projector Probe.lnk"), NODE: process.execPath, SCRIPT: script },
    },
  );
  const catalog = await os.catalog();
  const items = await catalog.listApplications();
  const probe = items.find((item) => item.name === "Projector Probe");
  expect(probe, JSON.stringify(items)).toBeTruthy();
  expect(probe.id).toMatch(/^app:.*Projector Probe\.lnk$/);
  expect(probe.keywords.toLowerCase()).toContain("node");
  await catalog.launchApplication(probe.id.slice(4));
  for (let i = 0; i < 100; i++) {
    if (await readFile(marker, "utf8").catch(() => "")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(await readFile(marker, "utf8")).toBe("started");
  await expect(catalog.launchApplication(join(root, "outside.lnk"))).rejects.toThrow(/не доступно/);
});

test.skipIf(!windows)("a real GTK window gets an HWND that the adapter can raise", async () => {
  const script = fileURLToPath(new URL("./fixtures/gtk-window.mjs", import.meta.url));
  const { stdout, stderr } = await execute(process.execPath, ["--import", "vio/register", script], {
    timeout: 50000,
  }).catch((error) => {
    throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`);
  });
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1), stderr);
  expect(result.handle).toBeGreaterThan(0);
  expect(result.window).toBe("True|Projector GTK smoke");
});

test.skipIf(!windows)("the real palette window is shown and actually painted", async () => {
  const script = fileURLToPath(new URL("./fixtures/palette-window.mjs", import.meta.url));
  const { stdout, stderr } = await execute(process.execPath, ["--import", "vio/register", script], {
    timeout: 80000,
    env: process.env,
  }).catch((error) => {
    throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`);
  });
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1), stderr);
  expect(result, JSON.stringify(result)).toMatchObject({ found: true, visible: true });
  expect(result.width).toBeGreaterThan(300);
  expect(result.height).toBeGreaterThan(100);
  // A blank or black rectangle has one or two colors; text, rows and borders have many.
  expect(result.colors, JSON.stringify(result)).toBeGreaterThan(8);
});
