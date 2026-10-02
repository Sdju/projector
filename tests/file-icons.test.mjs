import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";
import { createFileIconResolver } from "../core/modules/file-icons/index.ts";

const theme = JSON.parse(
  await readFile(new URL("../public/file-icons/theme.json", import.meta.url)),
);
const resolver = createFileIconResolver(theme);
const entry = (name, directory = false, path = name) => ({ name, directory, path });

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
    assert.equal(resolver.resolve(entry(name)).id, id, name);
});

test("directories never match file rules; expansion uses configured fallback and category colors", () => {
  assert.equal(resolver.resolve(entry("image.png", true)).id, "folder");
  assert.equal(resolver.resolve(entry("src", true)).id, "source");
  assert.equal(resolver.resolve(entry("unknown", true), true).id, "folder-open");
  const custom = structuredClone(theme);
  custom.rules.unshift({
    id: "custom-folder",
    kind: "directory",
    names: ["docs"],
    icon: "markdown",
  });
  const resolve = createFileIconResolver(custom).resolve;
  assert.equal(resolve(entry("docs", true), true).color, theme.palette.lavender);
  custom.rules[0].expandedIcon = "image";
  const expanded = createFileIconResolver(custom).resolve(entry("docs", true), true);
  assert.equal(expanded.id, "image");
  assert.equal(expanded.color, theme.palette.pink);
});

test("first matching rule wins and new types work entirely through configuration", () => {
  const custom = structuredClone(theme);
  custom.icons.custom = { src: "/file-icons/icons/custom.svg", color: "#123456" };
  custom.rules.unshift({ id: "new-type", kind: "file", extensions: ["custom.ts"], icon: "custom" });
  const changed = createFileIconResolver(custom);
  assert.deepEqual(changed.resolve(entry("new.custom.ts")), {
    id: "custom",
    src: "/file-icons/icons/custom.svg",
    color: "#123456",
    ruleId: "new-type",
  });
  assert.equal(changed.resolve(entry("ordinary.ts")).id, "typescript");
  custom.rules[0].icon = "file";
  assert.equal(changed.resolve(entry("new.custom.ts")).id, "custom", "resolver owns its snapshot");
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
    assert.equal(resolve(entry("data.json", false, path)).id, "database");
  assert.equal(resolve(entry("data.json", false, "schema/nested/data.json")).id, "json");
  assert.equal(resolve(entry("file[1]a.txt")).id, "image");
  assert.equal(resolve(entry("file1a.txt")).id, "markdown");
  assert.equal(resolve(entry("FILE[1]a.txt")).id, "markdown");
  assert.equal(resolve(entry("UPPER")).id, "env");
  assert.equal(resolve(entry("upper")).id, "file");
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
    assert.throws(() => createFileIconResolver(invalid));
  }
});

test("every shipped SVG exists and has a viewBox", async () => {
  for (const icon of Object.values(theme.icons)) {
    const path = new URL(`../public${icon.src}`, import.meta.url);
    await access(path);
    assert.match(await readFile(path, "utf8"), /<svg[^>]*viewBox=/);
  }
});
