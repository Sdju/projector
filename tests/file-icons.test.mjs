import { readFile, access } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { createFileIconResolver } from "../core/modules/file-icons/index.ts";

const theme = JSON.parse(
  await readFile(new URL("../public/file-icons/theme.json", import.meta.url)),
);
const resolver = createFileIconResolver(theme);
const entry = (name, directory = false, path = name) => ({ name, directory, path });
test("executable files take priority over names and extensions; directories keep folder icons", () => {
  for (const name of ["run", "package.json", "script.ts", "test.spec.ts"])
    expect(resolver.resolve({ ...entry(name), executable: true }).id, name).toBe("executable");
  expect(resolver.resolve({ ...entry("script.ts"), executable: false }).id).toBe("typescript");
  expect(resolver.resolve({ ...entry("src", true), executable: true }).id).toBe("folder");
  const custom = structuredClone(theme);
  custom.rules.unshift({
    id: "executable-typescript",
    kind: "file",
    extensions: ["ts"],
    executable: true,
    icon: "shell",
  });
  const resolve = createFileIconResolver(custom).resolve;
  expect(resolve({ ...entry("script.ts"), executable: true }).id).toBe("shell");
  expect(resolve(entry("script.ts")).id).toBe("typescript");
  expect(resolve({ ...entry("run"), executable: true }).id).toBe("executable");
  custom.rules[0].kind = "directory";
  delete custom.rules[0].extensions;
  expect(() => createFileIconResolver(custom)).toThrow();
});

test("shipped theme covers specific names, dotfiles, compound suffixes and common languages", () => {
  for (const [name, id] of [
    ["package.json", "package"],
    ["pnpm-lock.yaml", "lock"],
    [".gitignore", "ignore"],
    [".env.local", "env"],
    ["vite.config.ts", "vite"],
    ["tsconfig.app.json", "config"],
    ["FileTree.vue", "vue"],
    ["view.tsx", "react"],
    ["index.d.ts", "typescript"],
    ["PHOTO.PNG", "image"],
    ["archive.tar.gz", "archive"],
    ["file.test.ts", "tests"],
    ["main.py", "python"],
    ["LICENSE", "license"],
    ["Dockerfile.dev", "docker"],
    ["unknown.xyz", "file"],
    ["no-extension", "file"],
  ])
    expect(resolver.resolve(entry(name)).id, name).toBe(id);
});

test("directories never match file rules; expansion uses configured fallback and category colors", () => {
  expect(resolver.resolve(entry("image.png", true)).id).toBe("folder");
  expect(resolver.resolve(entry("src", true)).id).toBe("folder");
  expect(resolver.resolve(entry("src", true)).badge.id).toBe("source");
  expect(resolver.resolve(entry("unknown", true), true).id).toBe("folder-open");
  const custom = structuredClone(theme);
  custom.rules.unshift({
    id: "custom-folder",
    kind: "directory",
    names: ["docs"],
    icon: "markdown",
  });
  const resolve = createFileIconResolver(custom).resolve;
  expect(resolve(entry("docs", true), true).color).toBe(theme.palette.lavender);
  expect(resolve(entry("docs", true), true).badge.color).toBe(theme.palette.lavender);
  custom.rules[0].expandedIcon = "image";
  const expanded = createFileIconResolver(custom).resolve(entry("docs", true), true);
  expect(expanded.id).toBe("folder-open");
  expect(expanded.badge.id).toBe("image");
  expect(expanded.color).toBe(theme.palette.pink);
  expect(expanded.badge.color).toBe(theme.palette.pink);
});

test("directory badges survive expansion, while ordinary folders and files have no badge", () => {
  for (const [name, badge] of [
    ["src", "source"],
    ["ui", "components"],
    ["tests", "tests"],
    ["public", "assets"],
    ["docs", "markdown"],
    ["scripts", "shell"],
  ]) {
    const closed = resolver.resolve(entry(name, true));
    const opened = resolver.resolve(entry(name, true), true);
    expect(closed.id, name).toBe("folder");
    expect(opened.id, name).toBe("folder-open");
    expect(closed.badge.id, name).toBe(badge);
    expect(opened.badge, name).toStrictEqual(closed.badge);
  }
  expect(resolver.resolve(entry("unknown", true)).badge).toBe(undefined);
  expect(resolver.resolve(entry("unknown", true), true).badge).toBe(undefined);
  expect(resolver.resolve(entry("test.spec.ts")).badge).toBe(undefined);
});

test("first matching rule wins and new types work entirely through configuration", () => {
  const custom = structuredClone(theme);
  custom.icons.custom = { src: "/file-icons/icons/custom.svg", color: "#123456" };
  custom.rules.unshift({ id: "new-type", kind: "file", extensions: ["custom.ts"], icon: "custom" });
  const changed = createFileIconResolver(custom);
  expect(changed.resolve(entry("new.custom.ts"))).toStrictEqual({
    id: "custom",
    src: "/file-icons/icons/custom.svg",
    color: "#123456",
    ruleId: "new-type",
  });
  expect(changed.resolve(entry("ordinary.ts")).id).toBe("typescript");
  custom.rules[0].icon = "file";
  expect(changed.resolve(entry("new.custom.ts")).id, "resolver owns its snapshot").toBe("custom");
});

test("globs distinguish names and project paths, support zero-depth **/ and literal regex characters", () => {
  const custom = structuredClone(theme);
  custom.rules.unshift(
    { id: "path", kind: "file", paths: ["**/schema/*.json"], icon: "database" },
    { id: "literal", kind: "file", patterns: ["file[1]?.txt"], icon: "image", caseSensitive: true },
    { id: "case", kind: "file", names: ["UPPER"], icon: "env", caseSensitive: true },
  );
  const resolve = createFileIconResolver(custom).resolve;
  for (const path of ["schema/data.json", "src/schema/data.json", "src\\schema\\data.json"])
    expect(resolve(entry("data.json", false, path)).id).toBe("database");
  expect(resolve(entry("data.json", false, "schema/nested/data.json")).id).toBe("json");
  expect(resolve(entry("file[1]a.txt")).id).toBe("image");
  expect(resolve(entry("file1a.txt")).id).toBe("markdown");
  expect(resolve(entry("FILE[1]a.txt")).id).toBe("markdown");
  expect(resolve(entry("UPPER")).id).toBe("env");
  expect(resolve(entry("upper")).id).toBe("file");
});

test("invalid references, colors, URLs, duplicates and incomplete rules are rejected", () => {
  for (const mutate of [
    (value) => {
      value.defaults.file = "missing";
    },
    (value) => {
      value.rules[0].icon = "missing";
    },
    (value) => {
      value.rules[0].expandedIcon = "missing";
    },
    (value) => {
      value.rules.push(value.rules[0]);
    },
    (value) => {
      value.rules.unshift({ id: "empty", kind: "file", icon: "file" });
    },
    (value) => {
      value.icons.file.color = "missing";
    },
    (value) => {
      value.icons.file.src = "https://example.com/icon.svg";
    },
    (value) => {
      value.icons.file.src = "/file-icons/../secret.svg";
    },
    (value) => {
      value.version = 2;
    },
  ]) {
    const invalid = structuredClone(theme);
    mutate(invalid);
    expect(() => createFileIconResolver(invalid)).toThrow();
  }
});

test("every shipped SVG exists and has a viewBox", async () => {
  for (const icon of Object.values(theme.icons)) {
    const path = new URL(`../public${icon.src}`, import.meta.url);
    await access(path);
    expect(await readFile(path, "utf8")).toMatch(/<svg[^>]*viewBox=/);
  }
});
