import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

export const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);

/** Isolated Chromium for native input contracts; no user profile or app server. */
export async function createChromium(directory) {
  const child = spawn(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(directory, "chromium")}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let stderr = "";
  let socket;
  const close = async () => {
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    }
  };
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Chromium startup timed out: ${stderr.slice(-2000)}`)),
        15000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Chromium exited: ${stderr.slice(-2000)}`));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let nextId = 0;
    const pending = new Map();
    const errors = [];
    const lifecycle = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (["Inspector.targetCrashed", "Inspector.detached"].includes(message.method))
        lifecycle.push({ method: message.method, params: message.params });
      if (message.method === "Runtime.exceptionThrown")
        errors.push(message.params.exceptionDetails);
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error")
        errors.push(message.params.entry);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
    socket.on("close", () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP disconnected"));
      }
      pending.clear();
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    await call("Runtime.enable");
    await call("Page.enable");
    await call("Log.enable");
    await call("Inspector.enable");
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    return {
      close,
      call,
      evaluate,
      errors,
      get diagnostics() {
        return { stderr: stderr.slice(-3000), lifecycle };
      },
      // Self-running fixtures signal completion explicitly; no virtual-time budget or DOM dump.
      async result(url) {
        const navigation = await call("Page.navigate", { url });
        if (navigation.errorText) throw new Error(navigation.errorText);
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const result = await evaluate("document.querySelector('#result')?.textContent");
          if (result && result !== "WAITING") return result;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(
          `Fixture did not finish: ${url}\n${JSON.stringify(errors)}\n${stderr.slice(-2000)}`,
        );
      },
      async open(url) {
        await call("Page.navigate", { url });
        const deadline = Date.now() + 30000;
        while (!(await evaluate("Boolean(window.fixture?.ready)"))) {
          if (errors.length) throw new Error(JSON.stringify(errors));
          if (Date.now() > deadline) throw new Error("Fixture did not become ready");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      },
      viewport: (width, height = 900) =>
        call("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        }),
      async click(selector) {
        const point = await evaluate(
          `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
        await call("Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: "left",
          clickCount: 1,
          ...point,
        });
        await call("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
          ...point,
        });
      },
      async key(key, code = key) {
        const windowsVirtualKeyCode = {
          Enter: 13,
          Tab: 9,
          Escape: 27,
          ArrowLeft: 37,
          ArrowUp: 38,
          ArrowRight: 39,
          ArrowDown: 40,
          Home: 36,
          End: 35,
          " ": 32,
        }[key];
        await call("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          code,
          windowsVirtualKeyCode,
          ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
        });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
