import { os } from "../../../core/modules/os/index.ts";

/** One bounded JSON-RPC request over the authenticated local Codex CLI. */
export function codexRequest(method: string, params: unknown, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = os.tools.startCodexAppServer();
    let buffer = "";
    let settled = false;
    let requested = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
      child.once("close", () => clearTimeout(killTimer));
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Codex CLI не ответил вовремя")), timeoutMs);
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", () => finish(new Error("Codex CLI недоступен")));
    child.stdin.on("error", () => finish(new Error("Соединение с Codex CLI закрыто")));
    child.once("close", () => finish(new Error("Codex CLI завершился до ответа")));
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(new Error("Ответ Codex CLI слишком большой"));
      let end;
      while (!settled && (end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!message || typeof message !== "object") continue;
        if (message.id !== 1 && message.id !== 2) continue;
        if (message.error)
          return finish(new Error("Запрос Codex недоступен; проверьте вход в Codex CLI"));
        if (message.id === 1 && !requested) {
          requested = true;
          send({ method: "initialized" });
          send({ id: 2, method, params });
        } else if (message.id === 2 && requested) finish(undefined, message.result);
      }
    });
    child.stdout.setEncoding("utf8");
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "projector", title: "Projector", version: "1.0" },
        capabilities: null,
      },
    });
  });
}

export function readCodexRateLimits(timeoutMs = 15000) {
  return codexRequest("account/rateLimits/read", { excludeResetCreditDetails: true }, timeoutMs);
}
