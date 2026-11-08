import { createServer } from "node:http";
import { once } from "node:events";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { os } from "../packages/core/modules/os/index.ts";
import { handleApi } from "../packages/server/app/api.ts";
import { openRoute } from "../packages/server/modules/window/index.ts";

test("workspace routes open in a browser or window; native falls back to browser", async () => {
  const browser = vi.spyOn(os.windows, "openBrowser").mockImplementation(() => {});
  const window = vi.spyOn(os.windows, "open").mockImplementation(() => {});
  onTestFinished(() => vi.restoreAllMocks());

  expect(await openRoute("http://localhost:4177", "/projects/app", "browser")).toBe("browser");
  expect(browser).toHaveBeenCalledWith("http://localhost:4177/projects/app");

  expect(await openRoute("http://localhost:4177", "/projects/app", "window")).toBe("window");
  expect(window).toHaveBeenCalledWith("http://localhost:4177/projects/app");

  browser.mockClear();
  expect(await openRoute("http://localhost:4177", "/projects/app", "native")).toBe("browser");
  expect(browser).toHaveBeenCalledWith("http://localhost:4177/projects/app");
});

test("opening a route rejects addresses outside Projector", async () => {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["https://example.com/", "//example.com/"]) {
    const response = await fetch(`${base}/api/app/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route }),
    });
    expect(response.status).toBe(400);
  }
});
