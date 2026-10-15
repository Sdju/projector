import { expect, test } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { bashShellLaunch, createOs } from "../core/modules/os/index.ts";

test("container Bash does not inherit the host's PowerShell arguments", () => {
  const previous = process.env.SHELL;
  process.env.SHELL = "powershell.exe";
  try {
    const spec = { kind: "command", command: "printf 'container works'" };
    expect(createOs("win32").shellLaunch(spec).args).toContain("-Command");
    const launch = bashShellLaunch(spec, true);
    expect(launch).toStrictEqual({
      file: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", spec.command],
    });
    if (process.platform !== "win32") {
      const result = spawnSync(launch.file, launch.args, { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("container works");
    }
    expect(bashShellLaunch({ kind: "interactive" }).args).toStrictEqual(["-i"]);
    expect(bashShellLaunch({ kind: "program", executable: "agent" }).args).toStrictEqual([
      "-i",
      "-c",
      "exec agent",
    ]);
  } finally {
    if (previous === undefined) delete process.env.SHELL;
    else process.env.SHELL = previous;
  }
});
