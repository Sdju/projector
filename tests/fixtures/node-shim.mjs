// A command that runs a Node script: a shebang file on POSIX, a compiled stub on Windows, where
// CreateProcess (node-pty, execFile) cannot start `.cmd` files or scripts.
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPowerShell } from "../../core/modules/os/modules/windows/ps.ts";

const stub = (node, script) => `
using System;
using System.Diagnostics;
public static class Shim {
  static string Quote(string value) {
    return "\\"" + value.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"";
  }
  public static int Main(string[] args) {
    var line = Quote(@"${script}");
    foreach (var arg in args) line += " " + Quote(arg);
    var info = new ProcessStartInfo(@"${node}", line);
    info.UseShellExecute = false;
    using (var process = Process.Start(info)) {
      process.WaitForExit();
      return process.ExitCode;
    }
  }
}`;

/** Installs `<directory>/<name>` so that running it executes `source` (ESM) with Node. */
export async function installNodeCommand(directory, name, source) {
  if (process.platform !== "win32") {
    await writeFile(join(directory, name), `#!/usr/bin/env node\n${source}`, { mode: 0o700 });
    await chmod(join(directory, name), 0o700);
    return;
  }
  const script = join(directory, `${name}.mjs`);
  await writeFile(script, source);
  await runPowerShell(
    "Add-Type -OutputAssembly $env:SHIM_OUT -OutputType ConsoleApplication -TypeDefinition $env:SHIM_SOURCE",
    {
      env: {
        SHIM_OUT: join(directory, `${name}.exe`),
        SHIM_SOURCE: stub(process.execPath, script),
      },
      timeout: 60000,
    },
  );
}
