// Isolated browser acceptance server. Never binds Projector runtime hooks or writes its instance.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = await mkdtemp(join(tmpdir(), "projector-shared-browser-"));
process.env.XDG_DATA_HOME = root;
process.env.SHELL = join(root, "shell");
await writeFile(process.env.SHELL, '#!/bin/sh\nexec /bin/bash --noprofile --norc "$@"\n', {
  mode: 0o700,
});
await mkdir(join(root, "projector"));
const projects = Array.from({ length: 8 }, (_, index) => ({
  id: `probe-${index}`,
  name: `Probe ${index}`,
  path: root,
  commands: [],
  createdAt: "",
}));
await writeFile(join(root, "projector/projects.json"), JSON.stringify({ projects }));
const { attachTerminalServer, closeProjectTerminals } =
  await import("../../server/modules/terminal/index.ts");
const { attachTerminalControlServer, attachSharedTerminalServer } =
  await import("../../server/modules/terminal-control/index.ts");
const { handleApi } = await import("../../server/app/api.ts");
const live = new Map();
function attach(httpServer) {
  attachTerminalServer(httpServer);
  attachTerminalControlServer(httpServer);
  attachSharedTerminalServer(httpServer);
  httpServer.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/terminal/")) return;
    live.set(socket, url.pathname + (url.searchParams.get("kind") ?? ""));
    socket.once("close", () => live.delete(socket));
  });
}
function middleware(req, res, next) {
  if (req.url === "/__probe/drop" && req.method === "POST") {
    for (const [socket, path] of live)
      if (path.startsWith("/api/terminal/shared")) socket.destroy();
    res.end("dropped");
    return;
  }
  if (req.url === "/__probe") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        connections: [...live.values()],
        projects: projects.map(({ id, path }) => ({ id, path })),
      }),
    );
    return;
  }
  void handleApi(req, res)
    .then((handled) => {
      if (!handled) next();
    })
    .catch((error) => res.writeHead(500).end(error.message));
}
const port = Number(process.env.PROBE_PORT) || 4188;
let close;
if (process.env.PROBE_PRODUCTION === "1") {
  const { createServer } = await import("node:http");
  const { serveStatic } = await import("../../server/app/static.ts");
  const { fileURLToPath } = await import("node:url");
  const dist = fileURLToPath(new URL("../../dist", import.meta.url));
  const server = createServer((req, res) =>
    middleware(req, res, () => serveStatic(dist, req, res)),
  );
  attach(server);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  close = () => new Promise((resolve) => server.close(resolve));
} else {
  const { createServer } = await import("vite");
  const { default: config } = await import("../../vite.config.ts");
  const server = await createServer({
    ...config,
    configFile: false,
    cacheDir: join(root, "vite"),
    plugins: [
      ...config.plugins.filter(
        (plugin) => !["projector-api", "projector-feod"].includes(plugin.name),
      ),
      {
        name: "isolated-terminal-acceptance",
        configureServer(vite) {
          attach(vite.httpServer);
          vite.middlewares.use(middleware);
        },
      },
    ],
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  close = () => server.close();
}
console.log(
  `Isolated transport probe: http://localhost:${port} (${process.env.PROBE_PRODUCTION === "1" ? "production" : "dev"})`,
);
async function cleanup() {
  for (const project of projects) closeProjectTerminals(project.id);
  // All peers belong to this probe; release upgraded sockets before waiting for HTTP close.
  for (const socket of live.keys()) socket.destroy();
  await close();
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
