import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHub } from "../modules/gateway/index.ts";

const port = Number(process.env.PROJECTOR_HUB_PORT ?? 4180);
const host = process.env.PROJECTOR_HUB_HOST ?? "127.0.0.1";
const origin = process.env.PROJECTOR_HUB_ORIGIN ?? `http://localhost:${port}`;
const password = process.env.PROJECTOR_HUB_PASSWORD;
const deviceToken = process.env.PROJECTOR_HUB_DEVICE_TOKEN;
if (!password || !deviceToken || password === deviceToken)
  throw new Error("Задайте разные PROJECTOR_HUB_PASSWORD и PROJECTOR_HUB_DEVICE_TOKEN");
const staticRoot = fileURLToPath(new URL("../../../dist", import.meta.url));
if (!existsSync(`${staticRoot}/index.html`)) throw new Error("Сначала выполните vp run build");
const hub = createHub({
  origin,
  password,
  deviceToken,
  staticRoot,
  dataDir: process.env.PROJECTOR_HUB_DATA,
});
hub.server.listen(port, host, () => console.log(`Projector Hub: ${origin}`));
hub.server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
  hub.close();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => hub.close());
