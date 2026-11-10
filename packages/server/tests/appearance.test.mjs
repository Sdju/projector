import { createServer } from "node:http";
import { once } from "node:events";
import { expect, onTestFinished, test } from "vite-plus/test";
import {
  appearanceOptions,
  defaultAppearance,
  isAppearanceChoice,
  resolveScheme,
  schemeMode,
} from "../../core/modules/appearance/index.ts";
import { readAppearanceChoice, writeAppearanceChoice } from "../modules/appearance/index.ts";
import { handleApi } from "../app/api.ts";

test("appearance choice validates and resolves the system scheme", () => {
  expect(appearanceOptions.map((option) => option.id)).toStrictEqual([
    "dark",
    "light",
    "contrast",
    "auto",
  ]);
  expect(defaultAppearance).toBe("dark");
  expect(isAppearanceChoice("auto")).toBe(true);
  expect(isAppearanceChoice("light")).toBe(true);
  expect(isAppearanceChoice("contrast")).toBe(true);
  expect(isAppearanceChoice("sepia")).toBe(false);
  expect(resolveScheme("auto", true)).toBe("light");
  expect(resolveScheme("auto", false)).toBe("dark");
  expect(resolveScheme("light", true)).toBe("light");
  expect(resolveScheme("dark", true)).toBe("dark");
  expect(resolveScheme("contrast", true)).toBe("contrast");
  expect(schemeMode("light")).toBe("light");
  expect(schemeMode("dark")).toBe("dark");
  expect(schemeMode("contrast")).toBe("dark");
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

test("bootstrap script follows the saved choice on every request", async () => {
  await writeAppearanceChoice("auto");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/api/appearance/bootstrap.js`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/javascript");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const script = await response.text();
  expect(script).toContain('const choice = "auto"');
  expect(script).toContain('matchMedia("(prefers-color-scheme: light)")');
  expect(script).toContain("root.dataset.theme = scheme");

  await writeAppearanceChoice("light");
  const changed = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(changed).toContain('const choice = "light"');
  expect(changed).not.toBe(script);

  await writeAppearanceChoice("contrast");
  const contrast = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(contrast).toContain('const choice = "contrast"');
  expect(contrast).toContain('const mode = scheme === "light" ? "light" : "dark"');
});
