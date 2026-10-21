import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  fetchPage,
  htmlToText,
  isPrivateAddress,
} from "../server/modules/agents/projector/projector-web.ts";
import {
  configureWebSearch,
  storeSearchKey,
  webSearch,
  webSearchSettings,
} from "../server/modules/agents/projector/projector-web-search.ts";
import { guardWebFetch } from "../server/modules/agents/projector/projector-guard.ts";

let previous;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-web-"));
  process.env.PROJECTOR_SECRET_STORE = "file";
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  delete process.env.PROJECTOR_SECRET_STORE;
});

describe("agent web access", () => {
  it("tells local addresses from public ones", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.5",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
    ])
      expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"])
      expect(isPrivateAddress(address), address).toBe(false);
  });

  it("refuses to open pages on this machine, by address or by name", async () => {
    const hit = [];
    const local = createServer((_, res) => (hit.push(1), res.end("секрет")));
    await new Promise((done) => local.listen(0, "127.0.0.1", done));
    const { port } = local.address();
    try {
      await expect(fetchPage(`http://127.0.0.1:${port}/`)).rejects.toThrow(/локальной сети/);
      await expect(fetchPage(`http://localhost:${port}/`)).rejects.toThrow(/локальной сети/);
      await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(/http/);
      expect(hit).toEqual([]);
    } finally {
      local.close();
    }
  });

  it("turns HTML into plain text", () => {
    const { title, text } = htmlToText(
      "<html><head><title>Тест &amp; проверка</title><style>p{}</style></head><body><script>alert(1)</script><h1>Заголовок</h1><p>Первый <b>абзац</b>&nbsp;&#33;</p><ul><li>раз</li><li>два</li></ul></body></html>",
    );
    expect(title).toBe("Тест & проверка");
    expect(text).toBe("Заголовок\nПервый абзац !\n- раз\n- два");
  });

  it("asks once per site and remembers the answer", async () => {
    const asked = [];
    const guard = {
      trusting: false,
      approve: async (request) => (asked.push(request.title), "always"),
    };
    await guardWebFetch(guard, "https://example.org/a");
    await guardWebFetch(guard, "https://example.org/b");
    await guardWebFetch(guard, "https://other.example/");
    expect(asked).toEqual(["Открыть страницу на example.org", "Открыть страницу на other.example"]);
    await guardWebFetch({ trusting: true }, "https://third.example/");
    await expect(
      guardWebFetch({ trusting: false, approve: async () => false }, "https://denied.example/"),
    ).rejects.toThrow();
  });

  it("searches through SearXNG and keeps the Brave key out of the settings", async () => {
    const seen = [];
    const searx = createServer((req, res) => {
      seen.push(req.url);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          results: [
            { title: "Один", url: "https://a.example", content: "первый" },
            { title: "Два", url: "https://b.example", content: "второй" },
          ],
        }),
      );
    });
    await new Promise((done) => searx.listen(0, "127.0.0.1", done));
    const { port } = searx.address();
    try {
      await expect(webSearch("что-то")).rejects.toThrow(/Brave/);
      await expect(configureWebSearch({ provider: "searxng", url: "ftp://x" })).rejects.toThrow();
      await configureWebSearch({ provider: "searxng", url: `http://127.0.0.1:${port}/` });
      const results = await webSearch("тест запроса", 1);
      expect(results).toEqual([{ title: "Один", url: "https://a.example", snippet: "первый" }]);
      expect(seen[0]).toContain("q=%D1%82%D0%B5%D1%81%D1%82");
      expect(seen[0]).toContain("format=json");

      await storeSearchKey("brave-key");
      expect(await webSearchSettings()).toEqual({
        provider: "searxng",
        url: `http://127.0.0.1:${port}`,
        hasKey: true,
      });
      await configureWebSearch({ provider: "brave", url: "", apiKey: null });
      expect((await webSearchSettings()).hasKey).toBe(false);
    } finally {
      searx.close();
    }
  });
});
