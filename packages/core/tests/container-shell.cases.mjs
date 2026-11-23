import { expect, test } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { bashShellLaunch, createOs } from "../modules/os/index.ts";

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
    expect(
      bashShellLaunch({ kind: "program", executable: "/Users/me/My Tools/agent" }).args,
    ).toStrictEqual(["-i", "-c", "exec '/Users/me/My Tools/agent'"]);
    expect(
      createOs("linux").shellLaunch({ kind: "program", executable: "/opt/my agent/bin" }).args,
    ).toStrictEqual(["-i", "-c", "exec '/opt/my agent/bin'"]);
    expect(
      createOs("darwin").shellLaunch({ kind: "program", executable: "/Applications/My Agent" })
        .args,
    ).toStrictEqual(["-i", "-c", "exec '/Applications/My Agent'"]);
    const winProgram = createOs("win32").shellLaunch({
      kind: "program",
      executable: "C:\\Program Files\\Agent\\agent.exe",
    });
    if (/powershell|pwsh/i.test(winProgram.file))
      expect(winProgram.args).toContain("& 'C:\\Program Files\\Agent\\agent.exe'");
    else
      expect(winProgram.args).toStrictEqual([
        "-i",
        "-c",
        "exec 'C:\\Program Files\\Agent\\agent.exe'",
      ]);
  } finally {
    if (previous === undefined) delete process.env.SHELL;
    else process.env.SHELL = previous;
  }
});
