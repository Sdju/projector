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

test("appearance fonts are stored beside the colour scheme", async () => {
  const { writeAppearance, readAppearance } = await import("../modules/appearance/index.ts");
  await writeAppearanceChoice("dark");
  const saved = await writeAppearance({ fonts: { chat: 16 } });
  expect(saved.choice).toBe("dark");
  expect(saved.fonts).toStrictEqual({ chat: 16, editor: 13, terminal: 13 });
  await writeAppearanceChoice("light");
  expect(await readAppearance()).toStrictEqual({
    choice: "light",
    fonts: { chat: 16, editor: 13, terminal: 13 },
  });
});

test("appearance API reads and writes the saved choice", async () => {
  const { writeAppearance } = await import("../modules/appearance/index.ts");
  await writeAppearance({
    choice: "dark",
    fonts: { chat: 13, editor: 13, terminal: 13 },
  });
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const initial = await fetch(`${base}/api/appearance`);
  expect(initial.status).toBe(200);
  const initialBody = await initial.json();
  expect(initialBody.choice).toBe("dark");
  expect(initialBody.fonts).toStrictEqual({ chat: 13, editor: 13, terminal: 13 });
  expect(initialBody.themes.map((theme) => theme.id)).toStrictEqual(["dark", "light", "contrast"]);

  const saved = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: "light" }),
  });
  expect(saved.status).toBe(200);
  const savedBody = await saved.json();
  expect(savedBody.choice).toBe("light");
  expect(savedBody.fonts).toStrictEqual({ chat: 13, editor: 13, terminal: 13 });
  expect(await readAppearanceChoice()).toBe("light");

  const fonts = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ fonts: { terminal: 18 } }),
  });
  expect(fonts.status).toBe(200);
  expect(await fonts.json()).toStrictEqual({
    choice: "light",
    fonts: { chat: 13, editor: 13, terminal: 18 },
  });

  const invalid = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: "sepia" }),
  });
  expect(invalid.status).toBe(400);
  expect(await readAppearanceChoice()).toBe("light");
});

test("user JSON and CSS themes are discovered and selectable", async () => {
  const { mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { discoverUserThemes, userThemesDirectory } =
    await import("../modules/appearance/index.ts");
  const directory = userThemesDirectory();
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const tokens = JSON.parse(
    await readFile(new URL("./fixtures/theme-plugin/themes/paper.json", import.meta.url), "utf8"),
  );
  await writeFile(
    join(directory, "ocean.json"),
    JSON.stringify({ title: "Ocean", mode: "light", tokens }),
  );
  await writeFile(
    join(directory, "night.css"),
    `/* title: Night */\n/* mode: dark */\n:root {\n${Object.entries(tokens)
      .map(([name, value]) => `--${name}: ${value};`)
      .join("\n")}\n}\n`,
  );
  await writeFile(join(directory, "bad.css"), ":root { --bg: url(https://example.test/x); }");
  await writeFile(join(directory, "broken.json"), "{");

  const themes = await discoverUserThemes();
  expect(themes.map((theme) => theme.id)).toStrictEqual(["user/night", "user/ocean"]);
  expect(themes.find((theme) => theme.id === "user/ocean")?.mode).toBe("light");
  expect(themes.find((theme) => theme.id === "user/night")?.title).toBe("Night");

  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const listed = await (await fetch(`${base}/api/appearance`)).json();
  expect(listed.themes.map((theme) => theme.id)).toEqual(
    expect.arrayContaining(["user/night", "user/ocean"]),
  );
  const saved = await fetch(`${base}/api/appearance`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ choice: "user/ocean" }),
  });
  expect(saved.status).toBe(200);
  expect(await readAppearanceChoice()).toBe("user/ocean");
  const bootstrap = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(bootstrap).toContain('const choice = "user/ocean"');
  expect(bootstrap).toContain('"--bg":"#f4ecd8"');
  expect(bootstrap).toContain('const mode = "light"');
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
  expect(script).toContain('root.style.setProperty("--chat-fs", "13px")');
  expect(script).toContain(
    'const themeColors = {"dark":"#171716","light":"#efeee8","contrast":"#080808"}',
  );
  expect(script).toContain('meta[name="theme-color"]');

  await writeAppearanceChoice("light");
  const changed = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(changed).toContain('const choice = "light"');
  expect(changed).not.toBe(script);

  await writeAppearanceChoice("contrast");
  const contrast = await (await fetch(`${base}/api/appearance/bootstrap.js`)).text();
  expect(contrast).toContain('const choice = "contrast"');
  expect(contrast).toContain('const mode = scheme === "light" ? "light" : "dark"');
});
