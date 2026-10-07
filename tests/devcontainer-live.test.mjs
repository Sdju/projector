import { expect, test } from "vite-plus/test";
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

test(
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
      expect(usesDevcontainer(project)).toBe(false);
      await expect(runDevcontainerCommand(project, ["/bin/bash", "-c", "id"])).rejects.toThrow(
        /не использует/,
      );
      expect(await exists(join(path, "host-ran.txt")), "nothing runs before trust").toBe(false);

      await decideDevcontainer(project, "trusted", devcontainerState(project).hash);
      expect(await exists(join(path, "host-ran.txt")), "deciding does not run anything").toBe(
        false,
      );

      const ok = await runDevcontainerCommand(
        project,
        ["/bin/bash", "-c", "echo out; echo err >&2; id -un; pwd"],
        240_000,
      );
      expect(ok.stdout).toBe(`out\nnode\n/workspaces/${name}\n`);
      expect(ok.stderr).toMatch(/^err\n/);
      expect(await exists(join(path, "host-ran.txt")), "initializeCommand ran on the host").toBe(
        true,
      );
      expect(await exists(join(path, "created.txt")), "postCreateCommand ran inside").toBe(true);

      await expect(
        runDevcontainerCommand(project, ["/bin/bash", "-c", "echo before; exit 3"]),
      ).rejects.toSatisfy((error) => error.code === 3 && error.stdout === "before\n");
    } finally {
      const { removed } = await stopDevcontainer(project);
      expect(removed).toBe(1);
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
