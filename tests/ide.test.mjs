import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommandService,
  defaultKeybindings,
  parseKeybindings,
  matchesKey,
} from "../core/modules/ide/index.ts";

test("SDK executes scoped async commands with arguments, checks availability, and disposes registrations", async () => {
  const sdk = createCommandService(defaultKeybindings);
  let busy = false;
  const scope = sdk.createScope("project-a", () => ({ surface: "fileTree", entryKind: "file" }));
  const remove = scope.registerCommand({
    id: "ide.fileTree.file.rename",
    title: "Rename",
    enabled: () => !busy,
    run: async ({ path, name }) => ({ source: path, destination: name }),
  });
  scope.activate();
  assert.deepEqual(
    await sdk.executeCommand("ide.fileTree.file.rename", { path: "old.md", name: "new.md" }),
    { source: "old.md", destination: "new.md" },
  );
  busy = true;
  assert.equal(scope.describe("ide.fileTree.file.rename").enabled, false);
  assert.equal(scope.resolveKeybinding({ key: "F2" }), undefined);
  await assert.rejects(sdk.executeCommand("ide.fileTree.file.rename", {}), /недоступна/);
  busy = false;
  const other = sdk.createScope("project-b", () => ({ surface: "fileTree", entryKind: "file" }));
  other.registerCommand({ id: "ide.fileTree.file.rename", title: "Rename", run: () => "other" });
  assert.equal(
    await sdk.executeCommand("ide.fileTree.file.rename", {}, { scope: "project-b" }),
    "other",
  );
  assert.throws(
    () => scope.registerCommand({ id: "ide.fileTree.file.rename", title: "x", run: () => {} }),
    /уже зарегистрирована/,
  );
  remove();
  await assert.rejects(scope.executeCommand("ide.fileTree.file.rename"), /не зарегистрирована/);
  other.dispose();
  scope.dispose();
  assert.deepEqual(sdk.getCommands(), []);
  await assert.rejects(sdk.executeCommand("ide.fileTree.file.rename"), /не зарегистрирована/);
});

test("declarative overrides replace defaults, support contexts and unbinding, and protect text input", async () => {
  const sdk = createCommandService(defaultKeybindings);
  let kind = "file";
  let calls = 0;
  const scope = sdk.createScope("tree", () => ({ surface: "fileTree", entryKind: kind }));
  scope.registerCommand({ id: "ide.fileTree.file.rename", title: "Rename", run: () => calls++ });
  assert.equal(scope.resolveKeybinding({ key: "F2" }).command, "ide.fileTree.file.rename");
  assert.equal(scope.resolveKeybinding({ key: "F2" }, true), undefined);
  assert.equal(scope.resolveKeybinding({ key: "F2", isComposing: true }), undefined);
  assert.equal(scope.resolveKeybinding({ key: "F2", repeat: true }), undefined);
  sdk.setKeybindings([
    { key: "Ctrl+R", command: "ide.fileTree.file.rename", when: { entryKind: "file" } },
  ]);
  assert.equal(scope.resolveKeybinding({ key: "F2" }), undefined);
  assert.equal(
    scope.resolveKeybinding({ key: "r", ctrlKey: true }).command,
    "ide.fileTree.file.rename",
  );
  assert.equal(scope.describe("ide.fileTree.file.rename").shortcut, "Ctrl+R");
  kind = "directory";
  assert.equal(scope.resolveKeybinding({ key: "r", ctrlKey: true }), undefined);
  sdk.setKeybindings([{ key: "F2", command: "ide.fileTree.file.rename", disabled: true }]);
  assert.equal(scope.resolveKeybinding({ key: "F2" }), undefined);
  sdk.setKeybindings([]);
  kind = "file";
  assert.equal(scope.resolveKeybinding({ key: "F2" }).command, "ide.fileTree.file.rename");
  assert.equal(calls, 0, "Resolution and menu availability must not execute commands");
  assert.ok(matchesKey("Mod+S", { key: "s", ctrlKey: true }));
  assert.ok(matchesKey("Mod+S", { key: "s", metaKey: true }));
  assert.ok(!matchesKey("Mod+S", { key: "s", ctrlKey: true, altKey: true }));
  const editor = sdk.createScope("editor", () => ({ surface: "editor" }));
  editor.registerCommand({ id: "ide.editor.file.save", title: "Save", run: () => {} });
  assert.equal(
    editor.resolveKeybinding({ key: "s", ctrlKey: true }, true).command,
    "ide.editor.file.save",
  );
});

test("keybinding conflicts select the last applicable rule and preserve handler failures", async () => {
  const sdk = createCommandService();
  const scope = sdk.createScope("a", () => ({ surface: "tree" }));
  scope.registerCommand({ id: "one", title: "One", run: () => 1 });
  scope.registerCommand({
    id: "two",
    title: "Two",
    run: () => {
      throw new Error("real failure");
    },
  });
  sdk.setKeybindings([
    { key: "F2", command: "one" },
    { key: "F2", command: "two", when: { surface: "tree" } },
  ]);
  assert.equal(scope.resolveKeybinding({ key: "F2" }).command, "two");
  await assert.rejects(scope.executeCommand("two"), /real failure/);
  for (const value of [
    null,
    {},
    [{}],
    [{ key: "Ctrl+Ctrl+S", command: "x" }],
    [{ key: "Mod+Ctrl+S", command: "x" }],
    [{ key: "F2", command: "x", when: { bad: [] } }],
    [{ key: "F2", command: "x", disabled: "true" }],
  ])
    assert.throws(() => parseKeybindings(value));
});

test("keybindings persist atomically with validation and local HTTP origin protection", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-ide-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const { readKeybindings, writeKeybindings } = await import("../server/modules/ide/index.ts");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((r) => server.close(r));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + "/api/ide/keybindings";
  assert.deepEqual((await readKeybindings()).bindings, []);
  const binding = { key: "F6", command: "ide.fileTree.file.rename", when: { surface: "fileTree" } };
  const put = (bindings, origin = base) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ bindings }),
    });
  assert.equal((await put([binding], "https://foreign.test")).status, 403);
  assert.equal((await put([binding])).status, 200);
  const saved = await readKeybindings();
  assert.deepEqual(saved.bindings, [binding]);
  assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
  assert.equal((await put([{}])).status, 400);
  assert.deepEqual((await readKeybindings()).bindings, [binding]);
  const response = await fetch(url);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).bindings, [binding]);
  await writeKeybindings([]);
  assert.deepEqual(JSON.parse(await readFile(saved.path, "utf8")), []);
  await writeFile(saved.path, '{"bad":true}');
  await assert.rejects(readKeybindings(), /Ожидается/);
});

test("keyboard settings preserve other rules, conditions and arguments through edit, remove and reset", async () => {
  const { editKeybinding } = await import("../core/modules/ide/index.ts");
  const defaults = [
    {
      command: "menu",
      key: "Shift+F10",
      when: { surface: "tree" },
      args: { source: "keyboard" },
      allowInput: true,
    },
    { command: "menu", key: "ContextMenu", when: { surface: "tree" } },
    { command: "save", key: "Mod+S" },
  ];
  const original = structuredClone(defaults);
  const untouched = { command: "save", key: "Ctrl+Shift+S" };
  const edited = editKeybinding(defaults, [untouched], "menu", 0, "F6");
  assert.deepEqual(defaults, original);
  assert.deepEqual(edited[0], untouched);
  assert.deepEqual(edited[1], { ...defaults[0], key: "F6", disabled: false });
  assert.deepEqual(edited[2], defaults[1]);
  const removed = editKeybinding(defaults, edited, "menu", 0, null);
  const sdk = createCommandService(defaults);
  sdk.setKeybindings(removed);
  assert.deepEqual(
    sdk.getKeybindings().map((rule) => rule.key),
    ["Ctrl+Shift+S", "ContextMenu"],
  );
  sdk.setKeybindings(removed.filter((rule) => rule.command !== "menu"));
  assert.deepEqual(
    sdk.getKeybindings().filter((rule) => rule.command === "menu"),
    defaults.slice(0, 2),
  );
  const copy = sdk.getDefaultKeybindings();
  copy[0].key = "oops";
  assert.deepEqual(sdk.getDefaultKeybindings(), defaults);
  assert.deepEqual(editKeybinding([], [], "unbound", 0, "F9"), [
    { command: "unbound", key: "F9", disabled: false },
  ]);
});

test("shortcut recorder ignores modifiers, composition and repeats, and recorded strokes resolve", async () => {
  const { recordedKey } = await import("../core/modules/ide/index.ts");
  assert.equal(recordedKey({ key: "Control", ctrlKey: true }), undefined);
  assert.equal(recordedKey({ key: "a", isComposing: true }), undefined);
  assert.equal(recordedKey({ key: "F6", repeat: true }), undefined);
  assert.equal(recordedKey({ key: "Dead" }), undefined);
  assert.equal(recordedKey({ key: "+", shiftKey: true }), undefined);
  for (const event of [
    { key: "s", ctrlKey: true, shiftKey: true },
    { key: "F6" },
    { key: " ", altKey: true },
  ]) {
    const key = recordedKey(event);
    assert.equal(matchesKey(parseKeybindings([{ command: "test", key }])[0].key, event), true);
  }
});

test("command palette preserves originating scope, chooses project commands and searches IDs and titles", async () => {
  const { paletteCommands } = await import("../core/modules/ide/index.ts");
  const sdk = createCommandService(defaultKeybindings);
  const a = sdk.createScope("tree-a", () => ({ surface: "fileTree", projectId: "a" }));
  const b = sdk.createScope("tree-b", () => ({ surface: "fileTree", projectId: "b" }));
  const editor = sdk.createScope("editor-a", () => ({ surface: "editor", projectId: "a" }));
  const global = sdk.createScope("workbench", () => ({ surface: "workbench" }));
  for (const scope of [a, b])
    scope.registerCommand({ id: "file.rename", title: "Переименовать", run: () => scope.id });
  editor.registerCommand({
    id: "file.save",
    title: "Сохранить",
    enabled: () => false,
    run: () => {},
  });
  editor.registerCommand({
    id: "private.reorder",
    title: "Private",
    palette: false,
    run: () => {},
  });
  global.registerCommand({
    id: "ide.workbench.commandPalette.open",
    title: "Командный центр",
    run: () => sdk.getActiveScope(),
  });
  a.activate();
  assert.equal(
    global.resolveKeybinding({ key: "p", ctrlKey: true, shiftKey: true }, true).command,
    "ide.workbench.commandPalette.open",
  );
  assert.equal(
    global.resolveKeybinding({ key: "F1" }, true).command,
    "ide.workbench.commandPalette.open",
  );
  assert.equal(await global.executeCommand("ide.workbench.commandPalette.open"), "tree-a");
  const commands = paletteCommands(sdk.getCommands(), sdk.getScopes(), sdk.getActiveScope());
  assert.equal(commands.find((command) => command.id === "file.rename").scope, "tree-a");
  assert.equal(
    commands.some((command) => command.scope === "tree-b"),
    false,
  );
  assert.equal(
    commands.some((command) => command.id === "private.reorder"),
    false,
  );
  assert.equal(commands.at(-1).id, "file.save");
  assert.equal(
    paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "> Файлы переименовать")[0].id,
    "file.rename",
  );
  assert.equal(
    paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "file.rename")[0].scope,
    "tree-a",
  );
  assert.deepEqual(paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "missing"), []);
  assert.equal(
    await sdk.executeCommand(commands[0].id, undefined, { scope: commands[0].scope }),
    "tree-a",
  );
  await assert.rejects(
    sdk.executeCommand("file.save", undefined, { scope: "editor-a" }),
    /недоступна/,
  );
  sdk.setKeybindings([
    { command: "ide.workbench.commandPalette.open", key: "F6", allowInput: true },
  ]);
  assert.equal(global.resolveKeybinding({ key: "F1" }, true), undefined);
  assert.equal(
    global.resolveKeybinding({ key: "p", ctrlKey: true, shiftKey: true }, true),
    undefined,
  );
  assert.equal(
    global.resolveKeybinding({ key: "F6" }, true).command,
    "ide.workbench.commandPalette.open",
  );
});
