import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decideDevcontainer,
  devcontainerState,
  runDevcontainerCommand,
  stopDevcontainer,
  usesDevcontainer,
} from "../server/modules/devcontainer/index.ts";

// Builds a real container with the local Docker daemon, so it is opt-in.
const enabled = process.env.PROJECTOR_TEST_DEVCONTAINER === "1";
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

await test(
  "a trusted dev container runs commands, and nothing runs before the decision",
  { skip: !enabled },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "projector-devcontainer-live-"));
    process.env.XDG_DATA_HOME = join(root, "data");
    // A unique folder name makes the derived image (vsc-<name>-…) safe to find and remove.
    const name = `pdclive${process.pid}`;
    const path = join(root, name);
    await mkdir(join(path, ".devcontainer"), { recursive: true });
    await writeFile(
      join(path, ".devcontainer", "devcontainer.json"),
      JSON.stringify({
        image: "node:24-bookworm",
        remoteUser: "node",
        initializeCommand: "touch host-ran.txt",
        postCreateCommand: "touch created.txt",
      }),
    );
    const project = { id: "live", name: "live", path };
    try {
      assert.equal(usesDevcontainer(project), false);
      await assert.rejects(
        runDevcontainerCommand(project, ["/bin/bash", "-c", "id"]),
        /не использует/,
      );
      assert.equal(await exists(join(path, "host-ran.txt")), false, "nothing runs before trust");

      await decideDevcontainer(project, "trusted", devcontainerState(project).hash);
      assert.equal(
        await exists(join(path, "host-ran.txt")),
        false,
        "deciding does not run anything",
      );

      const ok = await runDevcontainerCommand(
        project,
        ["/bin/bash", "-c", "echo out; echo err >&2; id -un; pwd"],
        240_000,
      );
      assert.equal(ok.stdout, `out\nnode\n/workspaces/${name}\n`);
      assert.match(ok.stderr, /^err\n/);
      assert.equal(
        await exists(join(path, "host-ran.txt")),
        true,
        "initializeCommand ran on the host",
      );
      assert.equal(await exists(join(path, "created.txt")), true, "postCreateCommand ran inside");

      await assert.rejects(
        runDevcontainerCommand(project, ["/bin/bash", "-c", "echo before; exit 3"]),
        (error) => error.code === 3 && error.stdout === "before\n",
      );
    } finally {
      const { removed } = await stopDevcontainer(project);
      assert.equal(removed, 1);
      // The CLI builds a derived image per project; do not leave it behind.
      const images = execFileSync(
        "docker",
        ["images", "-q", "--filter", `reference=vsc-${name}-*`],
        {
          encoding: "utf8",
        },
      )
        .split("\n")
        .filter(Boolean);
      if (images.length) execFileSync("docker", ["rmi", "--force", ...images], { stdio: "ignore" });
      await rm(root, { recursive: true, force: true });
    }
  },
);
