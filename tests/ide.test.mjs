import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageReload } from "../src/modules/ide/reload.ts";
import {
  createCommandService,
  defaultKeybindings,
  parseKeybindings,
  matchesKey,
} from "../core/modules/ide/index.ts";

function reloadHost(replies, confirm = true) {
  const messages = [];
  const requests = [];
  const errors = [];
  let reloads = 0;
  let channel;
  const originals = {
    window: globalThis.window,
    BroadcastChannel: globalThis.BroadcastChannel,
    fetch: globalThis.fetch,
  };
  globalThis.window = { confirm: () => confirm, location: { reload: () => reloads++ } };
  globalThis.BroadcastChannel = class {
    closed = false;
    constructor() {
      channel = this;
    }
    postMessage(message) {
      messages.push(message);
    }
    close() {
      this.closed = true;
    }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    expect(reply, `Unexpected request: ${url}`).toBeTruthy();
    return { ok: reply.status !== false, json: async () => reply };
  };
  const host = createPageReload(
    (error) => errors.push(error),
    () => {},
  );
  onTestFinished(() => {
    host.dispose();
    Object.assign(globalThis, originals);
  });
  return { host, messages, requests, errors, channel, reloads: () => reloads };
}

test("page reload reaches the initiating page and peers and closes its channel", () => {
  const ctx = reloadHost([]);
  ctx.host.reloadPages();
  expect(ctx.messages).toStrictEqual([{ type: "reload" }]);
  expect(ctx.reloads()).toBe(1);
  ctx.channel.onmessage({ data: { type: "unrelated" } });
  expect(ctx.reloads()).toBe(1);
  ctx.channel.onmessage({ data: { type: "reload" } });
  expect(ctx.reloads()).toBe(2);
  ctx.host.dispose();
  expect(ctx.channel.closed).toBe(true);
});

test("server restart waits for a different PID, tolerates downtime and prevents duplicates", async () => {
  const health = (pid) => ({ ok: true, app: "projector", pid });
  const ctx = reloadHost([health(10), { ok: true }, health(10), new Error("offline"), health(11)]);
  const restart = ctx.host.restartServer();
  expect(ctx.host.isBusy()).toBe(true);
  await ctx.host.restartServer();
  expect(ctx.reloads()).toBe(0);
  await restart;
  expect(ctx.messages).toStrictEqual([{ type: "restart", pid: 10 }]);
  expect(ctx.requests.filter(({ url }) => url === "/api/app/restart").length).toBe(1);
  expect(ctx.reloads()).toBe(1);
  expect(ctx.host.isBusy()).toBe(false);
});

test("cancelled restart does not contact the server or reload pages", async () => {
  const ctx = reloadHost([], false);
  await ctx.host.restartServer();
  expect(ctx.requests).toStrictEqual([]);
  expect(ctx.messages).toStrictEqual([]);
  expect(ctx.reloads()).toBe(0);
});

test("rejected restart preserves pages and permits retry", async () => {
  const ctx = reloadHost([
    { ok: true, app: "projector", pid: 10 },
    { status: false, error: "denied" },
  ]);
  await expect(ctx.host.restartServer()).rejects.toThrow(/denied/);
  expect(ctx.messages).toStrictEqual([]);
  expect(ctx.reloads()).toBe(0);
  expect(ctx.host.isBusy()).toBe(false);
});

test("peer reloads only after successor health and ignores events after disposal", async () => {
  const ctx = reloadHost([{ ok: true, app: "projector", pid: 11 }]);
  ctx.channel.onmessage({ data: { type: "restart", pid: 10 } });
  await new Promise((resolve) => setImmediate(resolve));
  expect(ctx.reloads()).toBe(1);
  expect(ctx.requests.map(({ url }) => url)).toStrictEqual(["/api/health"]);
  ctx.host.dispose();
  ctx.channel.onmessage({ data: { type: "reload" } });
  expect(ctx.reloads()).toBe(1);
});

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
  expect(
    await sdk.executeCommand("ide.fileTree.file.rename", { path: "old.md", name: "new.md" }),
  ).toStrictEqual({ source: "old.md", destination: "new.md" });
  busy = true;
  expect(scope.describe("ide.fileTree.file.rename").enabled).toBe(false);
  expect(scope.resolveKeybinding({ key: "F2" })).toBe(undefined);
  await expect(sdk.executeCommand("ide.fileTree.file.rename", {})).rejects.toThrow(/недоступна/);
  busy = false;
  const other = sdk.createScope("project-b", () => ({ surface: "fileTree", entryKind: "file" }));
  other.registerCommand({ id: "ide.fileTree.file.rename", title: "Rename", run: () => "other" });
  expect(await sdk.executeCommand("ide.fileTree.file.rename", {}, { scope: "project-b" })).toBe(
    "other",
  );
  expect(() =>
    scope.registerCommand({ id: "ide.fileTree.file.rename", title: "x", run: () => {} }),
  ).toThrow(/уже зарегистрирована/);
  remove();
  await expect(scope.executeCommand("ide.fileTree.file.rename")).rejects.toThrow(
    /не зарегистрирована/,
  );
  other.dispose();
  scope.dispose();
  expect(sdk.getCommands()).toStrictEqual([]);
  await expect(sdk.executeCommand("ide.fileTree.file.rename")).rejects.toThrow(
    /не зарегистрирована/,
  );
});

test("declarative overrides replace defaults, support contexts and unbinding, and protect text input", async () => {
  const sdk = createCommandService(defaultKeybindings);
  let kind = "file";
  let calls = 0;
  const scope = sdk.createScope("tree", () => ({ surface: "fileTree", entryKind: kind }));
  scope.registerCommand({ id: "ide.fileTree.file.rename", title: "Rename", run: () => calls++ });
  expect(scope.resolveKeybinding({ key: "F2" }).command).toBe("ide.fileTree.file.rename");
  expect(scope.resolveKeybinding({ key: "F2" }, true)).toBe(undefined);
  expect(scope.resolveKeybinding({ key: "F2", isComposing: true })).toBe(undefined);
  expect(scope.resolveKeybinding({ key: "F2", repeat: true })).toBe(undefined);
  sdk.setKeybindings([
    { key: "Ctrl+R", command: "ide.fileTree.file.rename", when: { entryKind: "file" } },
  ]);
  expect(scope.resolveKeybinding({ key: "F2" })).toBe(undefined);
  expect(scope.resolveKeybinding({ key: "r", ctrlKey: true }).command).toBe(
    "ide.fileTree.file.rename",
  );
  expect(scope.describe("ide.fileTree.file.rename").shortcut).toBe("Ctrl+R");
  kind = "directory";
  expect(scope.resolveKeybinding({ key: "r", ctrlKey: true })).toBe(undefined);
  sdk.setKeybindings([{ key: "F2", command: "ide.fileTree.file.rename", disabled: true }]);
  expect(scope.resolveKeybinding({ key: "F2" })).toBe(undefined);
  sdk.setKeybindings([]);
  kind = "file";
  expect(scope.resolveKeybinding({ key: "F2" }).command).toBe("ide.fileTree.file.rename");
  expect(calls, "Resolution and menu availability must not execute commands").toBe(0);
  expect(matchesKey("Mod+S", { key: "s", ctrlKey: true })).toBeTruthy();
  expect(matchesKey("Mod+S", { key: "s", metaKey: true })).toBeTruthy();
  expect(matchesKey("Mod+S", { key: "ы", code: "KeyS", ctrlKey: true })).toBeTruthy();
  expect(
    matchesKey("Mod+Shift+P", { key: "З", code: "KeyP", ctrlKey: true, shiftKey: true }),
  ).toBeTruthy();
  expect(!matchesKey("Mod+S", { key: "ы", code: "KeyA", ctrlKey: true })).toBeTruthy();
  expect(!matchesKey("Mod+S", { key: "s", ctrlKey: true, altKey: true })).toBeTruthy();
  const editor = sdk.createScope("editor", () => ({ surface: "editor" }));
  editor.registerCommand({ id: "ide.editor.file.save", title: "Save", run: () => {} });
  expect(editor.resolveKeybinding({ key: "s", ctrlKey: true }, true).command).toBe(
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
  expect(scope.resolveKeybinding({ key: "F2" }).command).toBe("two");
  await expect(scope.executeCommand("two")).rejects.toThrow(/real failure/);
  for (const value of [
    null,
    {},
    [{}],
    [{ key: "Ctrl+Ctrl+S", command: "x" }],
    [{ key: "Mod+Ctrl+S", command: "x" }],
    [{ key: "F2", command: "x", when: { bad: [] } }],
    [{ key: "F2", command: "x", disabled: "true" }],
  ])
    expect(() => parseKeybindings(value)).toThrow();
});

test("keybindings persist atomically with validation and local HTTP origin protection", async () => {
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
  onTestFinished(async () => {
    await new Promise((r) => server.close(r));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + "/api/ide/keybindings";
  expect((await readKeybindings()).bindings).toStrictEqual([]);
  const binding = { key: "F6", command: "ide.fileTree.file.rename", when: { surface: "fileTree" } };
  const put = (bindings, origin = base) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ bindings }),
    });
  expect((await put([binding], "https://foreign.test")).status).toBe(403);
  expect((await put([binding])).status).toBe(200);
  const saved = await readKeybindings();
  expect(saved.bindings).toStrictEqual([binding]);
  expect((await stat(saved.path)).mode & 0o777).toBe(0o600);
  expect((await put([{}])).status).toBe(400);
  expect((await readKeybindings()).bindings).toStrictEqual([binding]);
  const response = await fetch(url);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).bindings).toStrictEqual([binding]);
  await writeKeybindings([]);
  expect(JSON.parse(await readFile(saved.path, "utf8"))).toStrictEqual([]);
  await writeFile(saved.path, '{"bad":true}');
  await expect(readKeybindings()).rejects.toThrow(/Ожидается/);
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
  expect(defaults).toStrictEqual(original);
  expect(edited[0]).toStrictEqual(untouched);
  expect(edited[1]).toStrictEqual({ ...defaults[0], key: "F6", disabled: false });
  expect(edited[2]).toStrictEqual(defaults[1]);
  const removed = editKeybinding(defaults, edited, "menu", 0, null);
  const sdk = createCommandService(defaults);
  sdk.setKeybindings(removed);
  expect(sdk.getKeybindings().map((rule) => rule.key)).toStrictEqual([
    "Ctrl+Shift+S",
    "ContextMenu",
  ]);
  sdk.setKeybindings(removed.filter((rule) => rule.command !== "menu"));
  expect(sdk.getKeybindings().filter((rule) => rule.command === "menu")).toStrictEqual(
    defaults.slice(0, 2),
  );
  const copy = sdk.getDefaultKeybindings();
  copy[0].key = "oops";
  expect(sdk.getDefaultKeybindings()).toStrictEqual(defaults);
  expect(editKeybinding([], [], "unbound", 0, "F9")).toStrictEqual([
    { command: "unbound", key: "F9", disabled: false },
  ]);
});

test("shortcut recorder ignores modifiers, composition and repeats, and recorded strokes resolve", async () => {
  const { recordedKey } = await import("../core/modules/ide/index.ts");
  expect(recordedKey({ key: "Control", ctrlKey: true })).toBe(undefined);
  expect(recordedKey({ key: "a", isComposing: true })).toBe(undefined);
  expect(recordedKey({ key: "F6", repeat: true })).toBe(undefined);
  expect(recordedKey({ key: "Dead" })).toBe(undefined);
  expect(recordedKey({ key: "+", shiftKey: true })).toBe(undefined);
  expect(recordedKey({ key: "ы", code: "KeyS", ctrlKey: true })).toBe("Ctrl+S");
  expect(recordedKey({ key: "З", code: "KeyP", ctrlKey: true, shiftKey: true })).toBe(
    "Ctrl+Shift+P",
  );
  for (const event of [
    { key: "s", ctrlKey: true, shiftKey: true },
    { key: "F6" },
    { key: " ", altKey: true },
    { key: "ы", code: "KeyS", ctrlKey: true },
  ]) {
    const key = recordedKey(event);
    expect(matchesKey(parseKeybindings([{ command: "test", key }])[0].key, event)).toBe(true);
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
  expect(global.resolveKeybinding({ key: "p", ctrlKey: true, shiftKey: true }, true).command).toBe(
    "ide.workbench.commandPalette.open",
  );
  expect(global.resolveKeybinding({ key: "F1" }, true).command).toBe(
    "ide.workbench.commandPalette.open",
  );
  expect(await global.executeCommand("ide.workbench.commandPalette.open")).toBe("tree-a");
  const commands = paletteCommands(sdk.getCommands(), sdk.getScopes(), sdk.getActiveScope());
  expect(commands.find((command) => command.id === "file.rename").scope).toBe("tree-a");
  expect(commands.some((command) => command.scope === "tree-b")).toBe(false);
  expect(commands.some((command) => command.id === "private.reorder")).toBe(false);
  expect(commands.at(-1).id).toBe("file.save");
  expect(
    paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "> Файлы переименовать")[0].id,
  ).toBe("file.rename");
  expect(
    paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "file.rename")[0].scope,
  ).toBe("tree-a");
  expect(paletteCommands(sdk.getCommands(), sdk.getScopes(), "tree-a", "missing")).toStrictEqual(
    [],
  );
  expect(await sdk.executeCommand(commands[0].id, undefined, { scope: commands[0].scope })).toBe(
    "tree-a",
  );
  await expect(sdk.executeCommand("file.save", undefined, { scope: "editor-a" })).rejects.toThrow(
    /недоступна/,
  );
  sdk.setKeybindings([
    { command: "ide.workbench.commandPalette.open", key: "F6", allowInput: true },
  ]);
  expect(global.resolveKeybinding({ key: "F1" }, true)).toBe(undefined);
  expect(global.resolveKeybinding({ key: "p", ctrlKey: true, shiftKey: true }, true)).toBe(
    undefined,
  );
  expect(global.resolveKeybinding({ key: "F6" }, true).command).toBe(
    "ide.workbench.commandPalette.open",
  );
});

test("editor themes default, persist, reject unknown values and protect HTTP writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-editor-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const { readEditorSettings, writeEditorSettings } =
    await import("../server/modules/ide/index.ts");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + "/api/ide/editor";
  const put = (theme, origin = base) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ theme }),
    });
  expect(await readEditorSettings()).toStrictEqual({ theme: "projector-soft" });
  expect((await put("one-dark", "https://foreign.test")).status).toBe(403);
  expect((await put("one-dark")).status).toBe(200);
  expect(await readEditorSettings()).toStrictEqual({ theme: "one-dark" });
  expect((await put("unknown")).status).toBe(400);
  expect(await readEditorSettings()).toStrictEqual({ theme: "one-dark" });
  const response = await fetch(url);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toStrictEqual({ theme: "one-dark" });
  await writeEditorSettings("projector-soft");
  const file = join(directory, "projector", "editor.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toStrictEqual({ theme: "projector-soft" });
  await writeFile(file, '{"theme":"removed-theme"}');
  expect(await readEditorSettings()).toStrictEqual({ theme: "projector-soft" });
});

test("files exclude defaults, persist globs, reject invalid patterns and protect HTTP writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-files-exclude-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const { readFilesExclude, writeFilesExclude } =
    await import("../server/modules/workspace/index.ts");
  const { defaultFilesExclude } = await import("../core/modules/workspace/index.ts");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = base + "/api/ide/files-exclude";
  const put = (exclude, origin = base) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ exclude }),
    });
  expect(await readFilesExclude()).toStrictEqual(defaultFilesExclude());
  expect(
    (await put({ ...defaultFilesExclude(), "**/node_modules": false }, "https://foreign.test"))
      .status,
  ).toBe(403);
  expect((await put({ ...defaultFilesExclude(), "**/node_modules": false })).status).toBe(200);
  expect((await readFilesExclude())["**/node_modules"]).toBe(false);
  expect(
    (await put({ ...defaultFilesExclude(), "../escape": true, ".projector-trash": true })).status,
  ).toBe(200);
  const saved = await readFilesExclude();
  expect(saved["../escape"]).toBe(undefined);
  expect(saved[".projector-trash"]).toBe(undefined);
  expect(saved["**/.projector-trash"]).toBe(undefined);
  expect(saved["**/node_modules"]).toBe(true);
  const response = await fetch(url);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).exclude).toStrictEqual(defaultFilesExclude());
  await writeFilesExclude({
    ...defaultFilesExclude(),
    "**/custom_build": true,
    "**/dist": false,
    "*.log": true,
  });
  const file = join(directory, "projector", "files-exclude.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toStrictEqual({
    exclude: {
      ...defaultFilesExclude(),
      "**/custom_build": true,
      "**/dist": false,
      "*.log": true,
    },
  });
});

test("mode switch is unavailable for the mode the server already runs in", async () => {
  const ctx = reloadHost([
    { ok: true, app: "projector", pid: 10, mode: "dev" },
    { ok: true, app: "projector", pid: 10, mode: "dev" },
  ]);
  expect(ctx.host.canSwitchMode("dev"), "unknown mode keeps both available").toBe(true);
  await ctx.host.refreshMode();
  expect(ctx.host.canSwitchMode("dev")).toBe(false);
  expect(ctx.host.canSwitchMode("prod")).toBe(true);
  await expect(ctx.host.switchMode("dev")).rejects.toThrow(/уже работает в режиме dev/);
  expect(
    ctx.requests.map(({ url }) => url),
    "no switch request is sent",
  ).toStrictEqual(["/api/health", "/api/health"]);
});
