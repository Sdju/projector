import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { handleApi } from "../server/app/api.ts";
import { setGatewayEnabled } from "../server/modules/openai-gateway/index.ts";
import { providersPath } from "../core/modules/app-paths/index.ts";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "projector-openai-gateway-"));
  const previous = { data: process.env.XDG_DATA_HOME, network: process.env.PROJECTOR_NETWORK };
  process.env.XDG_DATA_HOME = dir;
  process.env.PROJECTOR_NETWORK = "local";
  onTestFinished(async () => {
    for (const [key, value] of [
      ["XDG_DATA_HOME", previous.data],
      ["PROJECTOR_NETWORK", previous.network],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const seen = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({
      url: req.url,
      auth: req.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: one\n\n");
    res.end("data: [DONE]\n\n");
  });
  const upstreamPort = await listen(upstream);
  const { dataDir } = await import("../core/modules/app-paths/index.ts");
  await import("node:fs/promises").then((fs) => fs.mkdir(dataDir(), { recursive: true }));
  await writeFile(
    providersPath(),
    JSON.stringify({
      activeProviderId: "a",
      providers: [
        {
          id: "a",
          name: "A",
          url: `http://127.0.0.1:${upstreamPort}`,
          model: "model-a",
          apiKey: "",
        },
        {
          id: "b",
          name: "B",
          url: `http://127.0.0.1:${upstreamPort}/x/v2`,
          model: "model-b",
          apiKey: "",
        },
      ],
    }),
  );
  const gateway = createServer((req, res) => void handleApi(req, res));
  const port = await listen(gateway);
  return { seen, base: `http://127.0.0.1:${port}` };
}

test("gateway is off until enabled and reports OpenAI-shaped errors", async () => {
  const { base } = await setup();
  const response = await fetch(`${base}/api/openai/v1/models`);
  expect(response.status).toBe(404);
  expect((await response.json()).error.type).toBe("not_found_error");
  const enabled = await fetch(`${base}/api/openai`, {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  expect((await enabled.json()).enabled).toBe(true);
  expect((await fetch(`${base}/api/openai/v1/models`)).status).toBe(200);
});

test("gateway lists provider models and routes requests by model", async () => {
  const { base, seen } = await setup();
  setGatewayEnabled(true);
  const models = await (await fetch(`${base}/api/openai/v1/models`)).json();
  expect(models.data.map((item) => item.id)).toEqual(["model-a", "model-b"]);

  const streamed = await fetch(`${base}/api/openai/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "model-b", stream: true, messages: [] }),
  });
  expect(streamed.headers.get("content-type")).toContain("text/event-stream");
  expect(await streamed.text()).toContain("[DONE]");
  expect(seen[0].url).toBe("/x/v2/chat/completions");

  await fetch(`${base}/api/openai/v1/chat/completions`, { method: "POST", body: "{}" });
  expect(seen[1].url).toBe("/v1/chat/completions");
  expect(JSON.parse(seen[1].body).model).toBe("model-a");

  const bad = await fetch(`${base}/api/openai/v1/chat/completions`, { method: "POST", body: "[" });
  expect(bad.status).toBe(400);
});

test("gateway refuses foreign origins, preflight included, and sends no CORS headers", async () => {
  const { base } = await setup();
  setGatewayEnabled(true);
  const preflight = await fetch(`${base}/api/openai/v1/chat/completions`, {
    method: "OPTIONS",
    headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST" },
  });
  expect(preflight.status).toBe(403);
  expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

  const foreign = await fetch(`${base}/api/openai/v1/models`, {
    headers: { Origin: "https://example.org" },
  });
  expect(foreign.status).toBe(403);
  expect(foreign.headers.get("access-control-allow-origin")).toBeNull();

  const plain = await fetch(`${base}/api/openai/v1/models`);
  expect(plain.status).toBe(200);
});

test("a whitelisted origin gets its own origin echoed, others stay refused", async () => {
  const { base } = await setup();
  setGatewayEnabled(true);
  const put = await fetch(`${base}/api/openai`, {
    method: "PUT",
    body: JSON.stringify({ origins: ["https://app.example.com/path", "ftp://x", "junk"] }),
  });
  expect((await put.json()).origins).toEqual(["https://app.example.com"]);

  const preflight = await fetch(`${base}/api/openai/v1/chat/completions`, {
    method: "OPTIONS",
    headers: { Origin: "https://app.example.com", "Access-Control-Request-Method": "POST" },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

  const allowed = await fetch(`${base}/api/openai/v1/models`, {
    headers: { Origin: "https://app.example.com" },
  });
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

  const other = await fetch(`${base}/api/openai/v1/models`, {
    headers: { Origin: "https://evil.example.org" },
  });
  expect(other.status).toBe(403);
  expect(other.headers.get("access-control-allow-origin")).toBeNull();

  // The whitelist opens the gateway only, never the rest of the API.
  const rest = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://app.example.com" },
  });
  expect(rest.status).toBe(403);
});

test("an access key is required once set and is never a session for the rest of the API", async () => {
  const { base } = await setup();
  const set = await fetch(`${base}/api/openai`, {
    method: "PUT",
    body: JSON.stringify({ enabled: true, apiKey: "sk-test-key" }),
  });
  expect(await set.json()).toMatchObject({ enabled: true, hasKey: true });

  expect((await fetch(`${base}/api/openai/v1/models`)).status).toBe(401);
  const wrong = await fetch(`${base}/api/openai/v1/models`, {
    headers: { Authorization: "Bearer nope" },
  });
  expect(wrong.status).toBe(401);
  expect((await wrong.json()).error.type).toBe("authentication_error");
  const ok = await fetch(`${base}/api/openai/v1/models`, {
    headers: { Authorization: "Bearer sk-test-key" },
  });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("set-cookie")).toBeNull();

  const cleared = await fetch(`${base}/api/openai`, {
    method: "PUT",
    body: JSON.stringify({ apiKey: "" }),
  });
  expect((await cleared.json()).hasKey).toBe(false);
  expect((await fetch(`${base}/api/openai/v1/models`)).status).toBe(200);
});

test("in a password-protected LAN the gateway key replaces the password only for the gateway", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-openai-lan-"));
  const previous = { data: process.env.XDG_DATA_HOME, network: process.env.PROJECTOR_NETWORK };
  process.env.XDG_DATA_HOME = dir;
  process.env.PROJECTOR_NETWORK = "lan";
  onTestFinished(async () => {
    for (const [key, value] of [
      ["XDG_DATA_HOME", previous.data],
      ["PROJECTOR_NETWORK", previous.network],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const { setLanPassword, authorizeHttp } = await import("../server/modules/access/index.ts");
  const { setGatewayKey } = await import("../server/modules/openai-gateway/index.ts");
  setLanPassword("lan-password");
  setGatewayKey("sk-lan-key");

  const request = (url, authorization) => ({
    url,
    method: "GET",
    headers: { host: "192.0.2.1:4177", authorization },
    socket: { remoteAddress: "192.0.2.10" },
  });
  const response = () => {
    const headers = {};
    return {
      headers,
      setHeader: (name, value) => (headers[name.toLowerCase()] = value),
      hasHeader: (name) => name.toLowerCase() in headers,
      writeHead() {
        return this;
      },
      end() {},
    };
  };
  const attempt = (url, authorization) => {
    const res = response();
    return { allowed: authorizeHttp(request(url, authorization), res), res };
  };

  const key = attempt("/api/openai/v1/models", "Bearer sk-lan-key");
  expect(key.allowed).toBe(true);
  expect(key.res.headers["set-cookie"], "no session from a gateway key").toBeUndefined();
  expect(attempt("/api/openai/v1/models", "Bearer lan-password").allowed).toBe(false);
  expect(attempt("/api/projects", "Bearer sk-lan-key").allowed).toBe(false);
});

test("origin templates cover this machine and the local network on any port", async () => {
  const { base } = await setup();
  setGatewayEnabled(true);
  const put = await fetch(`${base}/api/openai`, {
    method: "PUT",
    body: JSON.stringify({ origins: ["@Localhost", "@lan", "@nope"] }),
  });
  expect((await put.json()).origins).toEqual(["@localhost", "@lan"]);
  const status = async (origin) =>
    (await fetch(`${base}/api/openai/v1/models`, { headers: { Origin: origin } })).status;
  for (const origin of [
    "http://localhost:5173",
    "https://127.0.0.1:8443",
    "http://[::1]:3000",
    "http://192.168.1.20:8080",
    "http://10.1.2.3",
    "http://172.20.0.5:3000",
    "http://nas.local:5000",
  ])
    expect(await status(origin), origin).toBe(200);
  for (const origin of [
    "https://example.org",
    "http://172.32.0.1",
    "http://8.8.8.8",
    "http://localhost.evil.com",
    "http://192.168.1.1.evil.com",
  ])
    expect(await status(origin), origin).toBe(403);
});
