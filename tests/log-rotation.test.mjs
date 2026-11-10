import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  openSync,
  closeSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import { rotateLog } from "../packages/core/modules/app-paths/logs.ts";

const logsModule = new URL("../packages/core/modules/app-paths/logs.ts", import.meta.url).href;

async function tempLog() {
  const directory = await mkdtemp(join(tmpdir(), "projector-log-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "server.log");
}

test("log rotation keeps the requested number of archives", async () => {
  const file = await tempLog();
  writeFileSync(file, "a".repeat(2048));
  expect(rotateLog(file, { maxBytes: 1024, maxFiles: 2 })).toBe(true);
  expect(existsSync(file)).toBe(false);
  expect(readFileSync(`${file}.1`, "utf8")).toBe("a".repeat(2048));
  writeFileSync(file, "b".repeat(2048));
  expect(rotateLog(file, { maxBytes: 1024, maxFiles: 2 })).toBe(true);
  expect(readFileSync(`${file}.1`, "utf8")).toBe("b".repeat(2048));
  expect(readFileSync(`${file}.2`, "utf8")).toBe("a".repeat(2048));
  writeFileSync(file, "c".repeat(2048));
  expect(rotateLog(file, { maxBytes: 1024, maxFiles: 2 })).toBe(true);
  expect(readFileSync(`${file}.1`, "utf8")).toBe("c".repeat(2048));
  expect(readFileSync(`${file}.2`, "utf8")).toBe("b".repeat(2048));
  expect(existsSync(`${file}.3`)).toBe(false);
});

test("a log below the limit is left untouched", async () => {
  const file = await tempLog();
  writeFileSync(file, "small");
  expect(rotateLog(file, { maxBytes: 1024, maxFiles: 2 })).toBe(false);
  expect(readFileSync(file, "utf8")).toBe("small");
  expect(existsSync(`${file}.1`)).toBe(false);
});

test("a running process rotates the log it writes to and keeps writing to the new file", async () => {
  const file = await tempLog();
  const fd = openSync(file, "a");
  const code = `
    (async () => {
      const { startServerLogRotation } = await import(${JSON.stringify(logsModule)});
      process.env.PROJECTOR_SERVER_LOG = process.env.TEST_LOG;
      startServerLogRotation();
      if (process.env.PROJECTOR_SERVER_LOG) process.exitCode = 2;
      for (let index = 0; index < 140; index += 1) {
        console.log("line " + index + " " + "x".repeat(80));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();
  `;
  const child = spawn(process.execPath, ["-e", code], {
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      TEST_LOG: file,
      PROJECTOR_LOG_MAX_BYTES: "2048",
      PROJECTOR_LOG_MAX_FILES: "2",
      PROJECTOR_LOG_CHECK_MS: "10",
    },
  });
  onTestFinished(() => {
    if (child.exitCode === null) child.kill();
    closeSync(fd);
  });
  await once(child, "exit");
  expect(child.exitCode, "rotation must not crash the process").toBe(0);
  expect(existsSync(`${file}.1`)).toBe(true);
  expect(existsSync(`${file}.2`)).toBe(true);
  expect(existsSync(`${file}.3`)).toBe(false);
  expect(statSync(file).size).toBeLessThan(4096);
  const current = readFileSync(file, "utf8");
  expect(current).toContain("[projector] rotated server.log");
  // The timer may rotate once more after the last write: the newest line is in the current
  // file or in the freshest archive, depending on that race.
  expect(`${current}${readFileSync(`${file}.1`, "utf8")}`).toContain("line 139");
  expect(readFileSync(`${file}.2`, "utf8")).toMatch(/line \d+/);
});
