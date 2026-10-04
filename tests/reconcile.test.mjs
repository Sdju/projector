import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { reconcileEnvironmentContainers } from "../server/modules/environments/index.ts";
import { serverId } from "../server/modules/environments/reconcile.ts";

await test("only containers of another Projector process are removed", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const filters = args.filter((_, i) => args[i - 1] === "--filter");
    if (args.includes("rm")) return { stdout: "" };
    // ours: carries the current server id; all: every Projector environment container.
    return {
      stdout: filters.some((f) => f.startsWith("label=io.projector.server="))
        ? "aaaaaaaaaaaa\n"
        : "aaaaaaaaaaaa\nbbbbbbbbbbbb\ncccccccccccc\n",
    };
  };
  assert.equal(await reconcileEnvironmentContainers(["default", "default"], run), 2);
  const removal = calls.find((args) => args.includes("rm"));
  assert.deepEqual(removal.slice(-2), ["bbbbbbbbbbbb", "cccccccccccc"]);
  assert.ok(!removal.includes("aaaaaaaaaaaa"), "live containers of this process stay");
  assert.equal(calls.filter((args) => args.includes("rm")).length, 1, "one pass per context");
});

await test("an unreachable daemon is not an error", async () => {
  const run = async () => {
    throw new Error("Cannot connect to the Docker daemon");
  };
  assert.equal(await reconcileEnvironmentContainers(["default"], run), 0);
});

const live = process.env.PROJECTOR_TEST_DOCKER === "1";
await test(
  "a real daemon: orphans go, ours and foreign containers stay",
  { skip: !live },
  async () => {
    const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
    const start = (name, ...labels) =>
      docker(
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        ...labels.flatMap((l) => ["--label", l]),
        "alpine",
        "sleep",
        "120",
      );
    const running = (name) => docker("ps", "-q", "--filter", `name=^${name}$`) !== "";
    const tag = `reconcile-test-${process.pid}`;
    const names = { orphan: `${tag}-orphan`, mine: `${tag}-mine`, foreign: `${tag}-foreign` };
    try {
      start(names.orphan, "io.projector.environment=x", "io.projector.server=dead-process");
      start(names.mine, "io.projector.environment=x", `io.projector.server=${serverId}`);
      start(names.foreign, "unrelated=true");
      const removed = await reconcileEnvironmentContainers(["default"]);
      assert.ok(removed >= 1);
      assert.equal(running(names.orphan), false);
      assert.equal(running(names.mine), true);
      assert.equal(running(names.foreign), true);
    } finally {
      for (const name of Object.values(names))
        try {
          docker("rm", "-f", name);
        } catch {
          /* already gone */
        }
    }
  },
);
