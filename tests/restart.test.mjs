import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { restartAfterExit, waitForProcessExit } from "../scripts/restart.mjs";
import { handleApi } from "../server/api.ts";

async function sleeper(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await once(child, "spawn");
  t.after(() => child.kill());
  return child;
}

test("restart launches exactly once after both old server and desktop have exited", async (t) => {
  const server = await sleeper(t);
  const desktop = await sleeper(t);
  let launches = 0;
  const restarting = restartAfterExit(server.pid, desktop.pid, () => {
    launches++;
  });
  await sleep(100);
  assert.equal(launches, 0, "do not reuse the old server");
  const exited = once(server, "exit");
  server.kill();
  await exited;
  await sleep(100);
  assert.equal(launches, 0, "do not reuse the old tray");
  const desktopExited = once(desktop, "exit");
  desktop.kill();
  await desktopExited;
  await restarting;
  assert.equal(launches, 1);
});

test("restart refuses to launch a replacement while shutdown is stuck", async (t) => {
  const child = await sleeper(t);
  await assert.rejects(waitForProcessExit(child.pid, 80), /не завершился/);
  assert.equal(child.exitCode, null);
});

test("restart endpoint rejects foreign origins and hosts before starting a worker", async (t) => {
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
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
    assert.equal(status, 403);
  }
  assert.equal(globalThis.projectorRestart, undefined);
});
