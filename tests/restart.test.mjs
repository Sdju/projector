import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, onTestFinished, test } from "vite-plus/test";
import { restartAfterExit, waitForProcessExit } from "../cli/app/restart.mjs";
import { handleApi } from "../server/app/api.ts";

async function sleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await once(child, "spawn");
  onTestFinished(() => child.kill());
  return child;
}

test("restart launches exactly once after both old server and desktop have exited", async () => {
  const server = await sleeper();
  const desktop = await sleeper();
  let launches = 0;
  const restarting = restartAfterExit(server.pid, desktop.pid, () => {
    launches++;
  });
  await sleep(100);
  expect(launches, "do not reuse the old server").toBe(0);
  const exited = once(server, "exit");
  server.kill();
  await exited;
  await sleep(100);
  expect(launches, "do not reuse the old tray").toBe(0);
  const desktopExited = once(desktop, "exit");
  desktop.kill();
  await desktopExited;
  await restarting;
  expect(launches).toBe(1);
});

test("restart refuses to launch a replacement while shutdown is stuck", async () => {
  const child = await sleeper();
  await expect(waitForProcessExit(child.pid, 80)).rejects.toThrow(/не завершился/);
  expect(child.exitCode).toBe(null);
});

test("restart endpoint rejects foreign origins and hosts before starting a worker", async () => {
  const previousRestart = Object.getOwnPropertyDescriptor(globalThis, "projectorRestart");
  let restartAttempts = 0;
  // Even a broken access guard must not reach the user's real desktop or launcher.
  Object.defineProperty(globalThis, "projectorRestart", {
    configurable: true,
    get() {
      restartAttempts++;
      throw new Error("Restart worker disabled in guard test");
    },
  });
  onTestFinished(() => {
    if (previousRestart) Object.defineProperty(globalThis, "projectorRestart", previousRestart);
    else delete globalThis.projectorRestart;
  });
  const previousNetwork = process.env.PROJECTOR_NETWORK;
  process.env.PROJECTOR_NETWORK = "local";
  onTestFinished(() => {
    if (previousNetwork === undefined) delete process.env.PROJECTOR_NETWORK;
    else process.env.PROJECTOR_NETWORK = previousNetwork;
  });
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/app/restart`;
  for (const headers of [{ Origin: "https://foreign.example" }, { Host: "foreign.example" }]) {
    // fetch overrides Host; a raw HTTP request exercises the actual guard.
    const status = await new Promise((resolve, reject) => {
      const req = request(url, { method: "POST", headers }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      req.once("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  }
  expect(restartAttempts).toBe(0);
});
