import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import {
  setWindowHostSpawn,
  stopWindowHost,
  windowCall,
} from "../core/modules/os/modules/windows/hwnd.ts";

test("the window helper releases its exit hook after normal exit and failed spawn", async () => {
  const count = process.listenerCount("exit");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(async () => {
    setWindowHostSpawn(null);
    await stopWindowHost();
    error.mockRestore();
  });
  let closed;
  setWindowHostSpawn(() => {
    const proc = spawn(
      process.execPath,
      [
        "-e",
        `
      const lines = require("node:readline").createInterface({ input: process.stdin });
      console.log("ready");
      lines.on("line", line => {
        if (line === "quit") process.exit(0);
        console.log("done " + line.split(" ")[0] + " 0");
      });
    `,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    closed = new Promise((resolve) => proc.once("close", resolve));
    return proc;
  });
  expect(await windowCall("foreground")).toBe("0");
  expect(process.listenerCount("exit")).toBe(count + 1);
  await stopWindowHost();
  await closed;
  expect(process.listenerCount("exit")).toBe(count);

  setWindowHostSpawn(() => {
    const proc = spawn(join(tmpdir(), "missing-projector-helper-" + randomUUID()));
    // Failed spawn emits error + close, but never exit.
    closed = new Promise((resolve) => proc.once("close", resolve));
    return proc;
  });
  expect(await windowCall("foreground")).toBe("");
  await closed;
  expect(process.listenerCount("exit")).toBe(count);
});
