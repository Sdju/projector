import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  launchHtml,
  parseCommands,
} from "../server/modules/project-presentation/implementation.ts";
import { scenarioDirectory } from "../server/modules/terminal/scenario-folder.ts";
import { commandError, settingsError } from "../src/modules/project/model/project-settings.ts";

const row = (extra) => ({ id: "a", name: "dev", cmd: "pnpm dev", ...extra });

test("a scenario keeps its folder, address and mode when they are valid", () => {
  const [command] = parseCommands([
    row({ cwd: "./apps\\web/", url: "http://localhost:5173", mode: "window" }),
  ]);
  expect(command).toEqual({
    id: "a",
    name: "dev",
    cmd: "pnpm dev",
    cwd: "apps/web",
    url: "http://localhost:5173",
    mode: "window",
  });
});

test("empty fields and unknown modes are dropped, meaning the project's own", () => {
  const [command] = parseCommands([row({ cwd: ".", url: "", mode: "docker" })]);
  expect(command).toEqual({ id: "a", name: "dev", cmd: "pnpm dev" });
});

test("a folder that leaves the project or an address that is not http(s) is refused", () => {
  expect(() => parseCommands([row({ cwd: "../other" })])).toThrow(/внутри проекта/);
  expect(() => parseCommands([row({ cwd: "/etc" })])).toThrow(/внутри проекта/);
  expect(() => parseCommands([row({ cwd: "C:/x" })])).toThrow(/внутри проекта/);
  expect(() => parseCommands([row({ url: "file:///etc/passwd" })])).toThrow(/http/);
});

test("a hidden folder is a folder name, not the project root", () => {
  expect(parseCommands([row({ cwd: ".config" })])[0].cwd).toBe(".config");
});

test("a project address cannot break out of the launch page script", () => {
  const url = "http://localhost:5173</script><script>alert(1)</script>";
  const html = launchHtml({ name: "demo", url }, url);
  expect(html.includes("</script><script>")).toBe(false);
  expect(html).toContain("http://localhost:5173\\u003c/script\\u003e");
});

test("the terminal folder must exist and stay inside the project, symlinks included", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenario-"));
  const outside = await mkdtemp(join(tmpdir(), "projector-outside-"));
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await writeFile(join(root, "file.txt"), "x");
  await symlink(outside, join(root, "escape"));
  expect(scenarioDirectory(root, "apps/web")).toBe(join(root, "apps", "web"));
  expect(() => scenarioDirectory(root, "missing")).toThrow(/не найдена/);
  expect(() => scenarioDirectory(root, "file.txt")).toThrow(/не найдена/);
  expect(() => scenarioDirectory(root, "escape")).toThrow(/не найдена/);
});

const draft = (commands, extra = {}) => ({
  name: "Проект",
  path: "/p",
  icon: "",
  url: "",
  mode: "server",
  defaultCommandId: commands[0]?.id,
  commands,
  ...extra,
});

test("the editor refuses what the server would refuse, with a reason per scenario", () => {
  const ok = { id: "a", name: "dev", cmd: "pnpm dev" };
  expect(settingsError(draft([ok]))).toBe("");
  expect(commandError({ ...ok, cwd: "../x" }, draft([ok]))).toMatch(/внутри проекта/);
  expect(commandError({ ...ok, url: "ftp://x" }, draft([ok]))).toMatch(/http/);
  expect(commandError({ ...ok, mode: "window" }, draft([ok]))).toMatch(/адрес/);
  expect(commandError({ ...ok, mode: "window", url: "http://x" }, draft([ok]))).toBe("");
  expect(commandError({ ...ok, mode: "" }, draft([ok], { mode: "window", url: "http://x" }))).toBe(
    "",
  );
});

test("scenario names must differ", () => {
  const first = { id: "a", name: "dev", cmd: "pnpm dev" };
  const second = { id: "b", name: " dev ", cmd: "pnpm start" };
  expect(settingsError(draft([first, second]))).toMatch(/уже есть/);
});
