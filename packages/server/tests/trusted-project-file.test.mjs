import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  contentHash,
  createTrustStore,
  projectRoot,
  readTrustedProjectFile,
  writeTrustedProjectFile,
} from "../modules/trusted-project-file/index.ts";

let directory;
let project;
let previous;
let trustFile;

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-project-file-trust-"));
  process.env.XDG_DATA_HOME = join(directory, "data");
  project = await realpath(await mkdtemp(join(directory, "project-")));
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Project", path: project, commands: [] }] }),
  );
  trustFile = join(directory, "data", "projector", "file-trust.json");
});

afterEach(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const store = (extra = {}) =>
  createTrustStore({ file: () => trustFile, fields: ["hash", "at"], ...extra });

const stateFile = () => join(project, ".projector", "state.json");
const stateText = (items) => `${JSON.stringify({ items }, null, 2)}\n`;

function spec(overrides = {}) {
  return {
    projectId: "p1",
    relativeFile: ".projector/state.json",
    trust: store(),
    parse: (text) => {
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Файл состояния проекта повреждён");
      }
      if (!Array.isArray(value?.items)) throw new Error("В файле состояния нет items");
      return value.items;
    },
    fallback: [],
    escape: "Файл состояния проекта указывает за его пределы",
    unreadable: "Не удалось прочитать состояние проекта",
    ...overrides,
  };
}

async function writeState(items) {
  await mkdir(join(project, ".projector"), { recursive: true });
  await writeFile(stateFile(), stateText(items), "utf8");
}

test("a missing file has nothing to trust", async () => {
  const state = await readTrustedProjectFile(spec());
  expect(state).toMatchObject({ root: project, exists: false, trusted: false, revoked: false });
  expect(state.value).toEqual([]);
  expect(state.problem).toBeUndefined();
});

test("trust is bound to the exact bytes and remembers a revoked hash", async () => {
  await writeState(["one"]);
  const root = await projectRoot("p1");
  const text = await readFile(stateFile(), "utf8");
  expect(contentHash(text)).toHaveLength(64);
  await store().set(root, { hash: contentHash(text), at: new Date().toISOString() });

  const trusted = await readTrustedProjectFile(spec());
  expect(trusted).toMatchObject({ exists: true, trusted: true, revoked: false, value: ["one"] });
  expect(trusted.hash).toBe(trusted.savedHash);

  await writeState(["one", "two"]);
  const changed = await readTrustedProjectFile(spec());
  expect(changed).toMatchObject({ exists: true, trusted: false, revoked: true });
  expect(changed.savedHash).toBe(trusted.hash);
  expect(changed.hash).not.toBe(changed.savedHash);
});

test("a trust file is private and holds only known fields", async () => {
  await writeState([]);
  const root = await projectRoot("p1");
  await store().set(root, { hash: "abc", at: "now", extra: "dropped" });
  const saved = JSON.parse(await readFile(trustFile, "utf8"));
  expect(saved).toEqual({ version: 1, projects: { [root]: { hash: "abc", at: "now" } } });
  if (process.platform !== "win32") {
    const { stat } = await import("node:fs/promises");
    expect((await stat(trustFile)).mode & 0o777).toBe(0o600);
  }
});

test("a file escaping the project through a symlink is refused", async () => {
  await mkdir(join(project, ".projector"), { recursive: true });
  const outside = join(directory, "outside.json");
  await writeFile(outside, stateText(["secret"]), "utf8");
  await symlink(outside, stateFile());

  const state = await readTrustedProjectFile(spec());
  expect(state).toMatchObject({ exists: false, trusted: false, revoked: false });
  expect(state.problem).toContain("пределы");
  await expect(
    writeTrustedProjectFile({
      ...spec(),
      change: (items) => items,
      write: () => Promise.resolve(),
      record: (hash) => ({ hash, at: "now" }),
    }),
  ).rejects.toThrow("пределы");
});

test("a broken project file is reported and cannot be written", async () => {
  await writeState([]);
  await writeFile(stateFile(), "{ broken", "utf8");
  const state = await readTrustedProjectFile(spec());
  expect(state).toMatchObject({ exists: true, trusted: false });
  expect(state.problem).toContain("повреждён");
  await expect(
    writeTrustedProjectFile({
      ...spec(),
      change: (items) => items,
      write: () => Promise.resolve(),
      record: (hash) => ({ hash, at: "now" }),
    }),
  ).rejects.toThrow("повреждён");
});

test("a broken trust file forgets trust, and a strict store refuses to guess", async () => {
  await writeState(["one"]);
  await writeFile(trustFile, "{ broken", "utf8");
  expect((await readTrustedProjectFile(spec())).trusted).toBe(false);

  const strict = store({ broken: "throw", version: 1 });
  await expect(strict.read()).rejects.toThrow("Некорректный файл доверия");
  await writeFile(trustFile, JSON.stringify({ version: 2, projects: {} }), "utf8");
  await expect(strict.read()).rejects.toThrow("Некорректный файл доверия");
  // Записи с неизвестным решением отбрасываются, а не считаются доверенными.
  const decisions = createTrustStore({
    file: () => trustFile,
    fields: ["decision", "hash"],
    valid: (entry) => entry.decision === "trusted",
  });
  await writeFile(
    trustFile,
    JSON.stringify({
      version: 1,
      projects: { [project]: { decision: "declined", hash: "x" } },
    }),
    "utf8",
  );
  expect(await decisions.entry(project)).toBeUndefined();
});

test("concurrent decisions keep every project", async () => {
  const roots = Array.from({ length: 20 }, (_, index) => `/projects/${index}`);
  await Promise.all(roots.map((root) => store().set(root, { hash: root, at: "now" })));
  const entries = await store().read();
  expect(Object.keys(entries).sort()).toEqual([...roots].sort());
  expect((await readdir(join(directory, "data", "projector"))).sort()).toEqual([
    "file-trust.json",
    "projects.json",
  ]);
});

test("the keep policy trusts a file it writes, the reset policy never does", async () => {
  const writer = (root, items) =>
    mkdir(join(root, ".projector"), { recursive: true }).then(() =>
      writeFile(join(root, ".projector", "state.json"), stateText(items), "utf8"),
    );
  const write = (overrides) =>
    writeTrustedProjectFile({
      ...spec(),
      write: writer,
      record: (hash) => ({ hash, at: "now" }),
      ...overrides,
    });

  const created = await write({ change: (items) => [...items, "first"], afterWrite: "keep" });
  expect(created).toMatchObject({ exists: true, trusted: true, value: ["first"] });
  const updated = await write({ change: (items) => [...items, "second"], afterWrite: "keep" });
  expect(updated.trusted).toBe(true);
  expect(updated.value).toEqual(["first", "second"]);

  const reset = await write({ change: (items) => items, afterWrite: "reset" });
  expect(reset).toMatchObject({ exists: true, trusted: false, revoked: false });
  expect(reset.value).toEqual(["first", "second"]);
});

test("a rehash policy keeps trust only while the bytes stay the same", async () => {
  await writeState(["one"]);
  const root = await projectRoot("p1");
  await store().set(root, { hash: contentHash(await readFile(stateFile(), "utf8")), at: "now" });
  const writer = (target, items) =>
    writeFile(join(target, ".projector", "state.json"), stateText(items));
  const write = (overrides) =>
    writeTrustedProjectFile({
      ...spec(),
      write: writer,
      record: (hash) => ({ hash, at: "now" }),
      ...overrides,
    });

  const same = await write({ change: (items) => items });
  expect(same.trusted).toBe(true);
  const changed = await write({ change: (items) => [...items, "two"] });
  expect(changed).toMatchObject({ trusted: false, revoked: true });
});
