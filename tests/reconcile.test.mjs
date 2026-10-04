import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { reconcileEnvironmentContainers } from "../server/modules/environments/index.ts";
import { serverId } from "../server/modules/environments/reconcile.ts";
import { os } from "../core/modules/os/index.ts";

await test("only containers whose owner process is gone are removed", async () => {
  const calls = [];
  const dead = "99999999-1";
  const lines = [
    `${"a".repeat(12)} ${serverId}`, // this process
    `${"b".repeat(12)} ${dead}`, // dead owner
    `${"c".repeat(12)} `, // no owner recorded
    `${"d".repeat(12)} ${process.ppid}-1`, // live pid but a different start time: pid reuse
    `${"e".repeat(12)} 123e4567-e89b-42d3-a456-426614174000`, // unknown format: left alone
    "garbage",
  ];
  const run = async (args) => {
    calls.push(args);
    return { stdout: args.includes("rm") ? "" : lines.join("\n") };
  };
  assert.equal(await reconcileEnvironmentContainers(["default", "default"], run), 3);
  const removal = calls.filter((args) => args.includes("rm"));
  assert.equal(removal.length, 1, "one pass per context");
  assert.deepEqual(removal[0].slice(-3), ["b".repeat(12), "c".repeat(12), "d".repeat(12)]);
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
    const names = {
      orphan: `${tag}-orphan`,
      mine: `${tag}-mine`,
      otherLive: `${tag}-other-live`,
      foreign: `${tag}-foreign`,
    };
    // Another Projector that is still running (the test runner's parent) must not be touched.
    const liveOwner = `${process.ppid}-${os.processes.identity(process.ppid)}`;
    try {
      start(names.orphan, "io.projector.environment=x", "io.projector.server=99999999-1");
      start(names.mine, "io.projector.environment=x", `io.projector.server=${serverId}`);
      start(names.otherLive, "io.projector.environment=x", `io.projector.server=${liveOwner}`);
      start(names.foreign, "unrelated=true");
      const removed = await reconcileEnvironmentContainers(["default"]);
      assert.ok(removed >= 1);
      assert.equal(running(names.orphan), false);
      assert.equal(running(names.mine), true);
      assert.equal(running(names.otherLive), true, "a live Projector keeps its containers");
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
