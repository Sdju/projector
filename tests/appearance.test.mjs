import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import {
  appearanceOptions,
  defaultAppearance,
  isAppearanceChoice,
  resolveScheme,
} from "../packages/core/modules/appearance/index.ts";
import {
  readAppearanceChoice,
  writeAppearanceChoice,
} from "../packages/server/modules/appearance/index.ts";
import { handleApi } from "../packages/server/app/api.ts";
import { serveStatic } from "../packages/server/app/static.ts";

test("appearance choice validates and resolves the system scheme", () => {
  expect(appearanceOptions.map((option) => option.id)).toStrictEqual(["dark", "light", "auto"]);
  expect(defaultAppearance).toBe("dark");
  expect(isAppearanceChoice("auto")).toBe(true);
  expect(isAppearanceChoice("light")).toBe(true);
  expect(isAppearanceChoice("sepia")).toBe(false);
  expect(resolveScheme("auto", true)).toBe("light");
  expect(resolveScheme("auto", false)).toBe("dark");
  expect(resolveScheme("light", true)).toBe("light");
  expect(resolveScheme("dark", true)).toBe("dark");
});

test("appearance is stored on disk and invalid values are rejected", async () => {
  expect(await writeAppearanceChoice("dark")).toStrictEqual({ choice: "dark" });
  expect(await readAppearanceChoice()).toBe("dark");
  expect(await writeAppearanceChoice("auto")).toStrictEqual({ choice: "auto" });
  expect(await readAppearanceChoice()).toBe("auto");
  await expect(writeAppearanceChoice("sepia")).rejects.toThrow(/Неизвестная цветовая схема/);
  expect(await readAppearanceChoice()).toBe("auto");
});

test("appearance API reads and writes the saved choice", async () => {
  await writeAppearanceChoice("dark");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const initial = await fetch(`${base}/api/appearance`);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toStrictEqual({ choice: "dark" });

  const saved = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: "light" }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toStrictEqual({ choice: "light" });
  expect(await readAppearanceChoice()).toBe("light");

  const invalid = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: "sepia" }),
  });
  expect(invalid.status).toBe(400);
  expect(await readAppearanceChoice()).toBe("light");
});

test("index.html gets the stored appearance before first paint", async () => {
  await writeAppearanceChoice("light");
  const root = await mkdtemp(join(tmpdir(), "projector-appearance-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html lang="ru" data-appearance="__PROJECTOR_APPEARANCE__"></html>',
  );
  const server = createServer((req, res) => {
    void serveStatic(root, req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ["/", "/project/workspace"]) {
    const response = await fetch(base + path);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toContain('data-appearance="light"');
  }
});
