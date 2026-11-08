import { createServer, request } from "node:http";
import { once } from "node:events";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../packages/server/app/api.ts";

test("API dispatch preserves fallthrough, method errors and the canonical MCP endpoint", async () => {
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(418).end("fallthrough");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const call = (path, method = "GET") =>
    new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  try {
    const health = await call("/api/health?source=routing-test");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ ok: true, app: "projector" });
    expect((await call("/api/health/")).status).toBe(200);
    expect((await call("/api/health", "POST")).status).toBe(404);
    expect((await call("/api/browser/session", "POST")).status).toBe(405);
    expect((await call("/api/unknown-route")).status).toBe(404);
    expect(await call("/projects/example")).toEqual({ status: 418, body: "fallthrough" });
    const mcp = await call("/api/agent/mcp");
    expect(mcp.status).toBe(200);
    expect(JSON.parse(mcp.body)).toMatchObject({
      text: expect.any(String),
      servers: expect.any(Array),
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
