import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";
import feod from "../feod.config.mjs";
import { checkFeod } from "../scripts/check-feod.mjs";

const temporary = [];
afterAll(() =>
  temporary.forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

/** Build a fixture project, lint it with Projector's real FEOD policy, group rules by file. */
function lint(files, config = feod) {
  const rootDir = mkdtempSync(join(tmpdir(), "projector-arch-"));
  temporary.push(rootDir);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(rootDir, file)), { recursive: true });
    writeFileSync(join(rootDir, file), contents);
  }
  const byFile = {};
  const messages = [];
  for (const item of checkFeod({ rootDir, config })) {
    const file = item.file.replace(`${rootDir}/`, "");
    (byFile[file] ??= new Set()).add(item.rule);
    messages.push(item.message);
  }
  // Inventory-wide findings attach to whichever file is linted first; assert them by message.
  Object.defineProperty(byFile, "messages", { value: messages });
  return byFile;
}
const lines = (count) => "export {};\n" + "void 0;\n".repeat(count);
const index = (name = "x") => `export const ${name} = 1;\n`;

test("valid layers, public entries, transit adapters and shared cores pass", () => {
  expect(
    lint({
      "src/app/entry.ts":
        'import { a } from "../modules/a"; import { t } from "../modules/agents-integration/one"; export const v = [a, t];',
      "src/pages/index.vue":
        '<script setup lang="ts">import { a } from "../modules/a"; void a;</script>',
      "src/modules/a/index.ts":
        'export { a } from "./model"; export { c } from "../../common/util";',
      "src/modules/a/model.ts": index("a"),
      "src/common/util.ts": index("c"),
      "src/modules/agents-integration/_/core.ts": index("core"),
      "src/modules/agents-integration/one/index.ts":
        'import { core } from "../_/core"; export const t = core;',
      "src/modules/agents-integration/two/index.ts":
        'import { core } from "../_/core"; export const u = core;',
      "server/routes/api.ts": 'import { s } from "../modules/s"; export const r = s;',
      "server/modules/s/index.ts": index("s"),
      "core/modules/shared-contract/index.ts": index("k"),
    }),
  ).toStrictEqual({});
});

test("module internals, nested modules and transit private core stay private", () => {
  const result = lint({
    "src/modules/a/index.ts": index("a"),
    "src/modules/a/model.ts": index("m"),
    "src/modules/a/modules/b/index.ts": index("b"),
    "src/modules/a/modules/b/modules/c/index.ts": index("c"),
    "src/modules/agents-integration/_/core.ts": index("core"),
    "src/modules/agents-integration/one/index.ts": index("one"),
    "src/modules/agents-integration/one/private.ts": index("p"),
    "src/modules/other/index.ts":
      'import { m } from "../a/model"; import { b } from "../a/modules/b"; import { core } from "../agents-integration/_/core"; import { p } from "../agents-integration/one/private"; export const o = [m, b, core, p];',
    "src/modules/a/deep.ts": 'import { c } from "./modules/b/modules/c"; export const d = c;',
  });
  expect(
    result["src/modules/other/index.ts"]?.has("layer-imports"),
    "outsider reaches internals",
  ).toBeTruthy();
  expect(
    result["src/modules/a/deep.ts"],
    "grandchild is not a public API of its grandparent",
  ).toBeTruthy();
});

test("upper layers, siblings, globals and cross-application internals are isolated", () => {
  const result = lint({
    "src/app/router.ts": index("r"),
    "src/globals/env.d.ts": "export {};\n",
    "src/modules/m/index.ts": 'import { r } from "../../app/router"; export const m = r;',
    "src/common/util.ts": 'import { m } from "../modules/m"; export const u = m;',
    "src/pages/index.vue":
      '<script setup lang="ts">import { s } from "./settings.vue"; void s;</script>',
    "src/pages/settings.vue": '<script setup lang="ts">export const s = 1;</script>',
    "src/app/entry.ts":
      'import type {} from "../globals/env.d.ts"; import { p } from "../../server/modules/p"; export const e = p;',
    "server/modules/p/index.ts": index("p"),
    "server/routes/api.ts": 'import { o } from "../middlewares/origin"; export const a = o;',
    "server/middlewares/origin.ts": index("o"),
    "core/modules/c/index.ts": 'import { m } from "../../../src/modules/m"; export const c = m;',
  });
  for (const file of [
    "src/modules/m/index.ts",
    "src/common/util.ts",
    "src/pages/index.vue",
    "src/app/entry.ts",
    "server/routes/api.ts",
    "core/modules/c/index.ts",
  ])
    expect(result[file], `${file} must be rejected`).toBeTruthy();
});

test("browser code cannot use Node infrastructure; the OS facade hides its implementation", () => {
  const result = lint({
    "src/modules/w/index.ts":
      'import fs from "node:fs"; import { os } from "@core/os"; export const w = [fs, os];',
    "core/modules/launcher/index.ts": 'import pty from "node-pty"; export const l = pty;',
    "core/modules/os/index.ts": 'export * from "./modules/linux";',
    "core/modules/os/modules/linux/index.ts": index("linux"),
    "server/modules/t/index.ts":
      'import { linux } from "../../../core/modules/os/modules/linux"; export const t = linux;',
    "cli/app/launch.mjs": 'import { os } from "../../core/modules/os"; export const run = os;',
  });
  expect(result["src/modules/w/index.ts"]?.has("confine")).toBeTruthy();
  expect(result["core/modules/launcher/index.ts"]?.has("confine")).toBeTruthy();
  expect(
    result["server/modules/t/index.ts"],
    "Linux implementation is private to the facade",
  ).toBeTruthy();
  expect(result["cli/app/launch.mjs"], "applications may use the OS facade").toBe(undefined);
});

test("Linux and Windows operations stay inside their adapters", () => {
  const result = lint({
    "core/modules/os/modules/linux/index.ts": 'export const p = "/proc/1/stat";',
    "core/modules/os/modules/windows/index.ts": 'export const k = "taskkill";',
    "core/modules/os/index.ts": index("os"),
    "server/modules/s/index.ts":
      'export const a = "/proc/self"; export const b = "powershell.exe"; export const c = ["xdotool"];',
  });
  expect(result["core/modules/os/modules/linux/index.ts"]).toBe(undefined);
  expect(result["core/modules/os/modules/windows/index.ts"]).toBe(undefined);
  expect(result["server/modules/s/index.ts"]?.has("confine")).toBeTruthy();
});

test("computed and unresolved imports are rejected; literal native file URLs are checked", () => {
  const result = lint({
    "src/modules/m/index.ts": index("m"),
    "src/modules/computed/index.ts":
      'const name = "x"; export const a = import(name); export const b = require(name);',
    "src/modules/missing/index.ts": 'import { nope } from "./nope"; export const n = nope;',
    "src/modules/url/index.ts":
      'export const u = import(new URL("../m/index.ts", import.meta.url).href); export const bad = import(new URL("../m/internal.ts", import.meta.url).href);',
    "src/modules/m/internal.ts": index("i"),
  });
  expect(result["src/modules/computed/index.ts"]?.has("layer-imports")).toBeTruthy();
  expect(result["src/modules/missing/index.ts"]?.has("layer-imports")).toBeTruthy();
  expect(
    result["src/modules/url/index.ts"],
    "non-public literal URL target is rejected",
  ).toBeTruthy();
});

test("entries, names, globals and stray files follow the structure", () => {
  const result = lint({
    "src/modules/no-entry/impl.ts": index("i"),
    "src/modules/shared/index.ts": index("s"),
    "src/modules/agents-integration/_/core.ts": index("core"),
    "src/modules/agents-integration/one/index.ts": index("one"),
    "src/globals/ok.d.ts": "export {};\n",
    "src/globals/bad.ts": index("bad"),
    "src/orphan/note.ts": index("o"),
  });
  const text = result.messages.join("\n");
  expect(text).toMatch(/module 'src\/modules\/no-entry' is missing a public entry/);
  expect(text).toMatch(/module name 'shared' is forbidden/);
  expect(result["src/globals/bad.ts"]?.has("global-files")).toBeTruthy();
  expect(result["src/orphan/note.ts"]?.has("no-unknown-files")).toBeTruthy();
  expect(!result["src/globals/ok.d.ts"]?.has("global-files")).toBeTruthy();
  expect(text, "transit container and private core need no entry").not.toMatch(
    /agents-integration/,
  );
});

test("module cycles are rejected, including type edges, while shared dependencies stay acyclic", () => {
  const result = lint({
    "src/modules/a/index.ts": 'import { b } from "../b"; export const a = b;',
    "src/modules/b/index.ts":
      'import type { a } from "../a"; export type B = typeof a; export const b = 1;',
    "src/modules/agents-integration/_/core.ts": index("core"),
    "src/modules/agents-integration/one/index.ts":
      'import { core } from "../_/core"; export const one = core;',
    "src/modules/agents-integration/two/index.ts":
      'import { core } from "../_/core"; export const two = core;',
    "src/modules/parent/index.ts": index("p"),
    "src/modules/parent/modules/child/index.ts":
      'import type { p } from "../.."; export type C = typeof p;',
  });
  expect(
    Object.values(result).some((rules) => rules.has("no-module-cycles")),
    "a <-> b via a type edge",
  ).toBeTruthy();
  expect(Object.values(result).filter((rules) => rules.has("no-module-cycles")).length).toBe(1);
});

test("the large-file registry is a ratchet with per-extension limits", () => {
  const withRegistry = (files) => ({
    ...feod,
    rootDefault: {
      ...feod.rootDefault,
      extra: {
        ...feod.rootDefault.extra,
        largeFiles: { thresholds: { default: 400, ".vue": 500 }, files },
      },
    },
  });
  const fixture = {
    "src/modules/a/index.ts": index("a"),
    "src/modules/a/ok.ts": lines(399),
    "src/modules/a/ok.vue": `<script setup lang="ts">\n${"void 0;\n".repeat(480)}</script>\n`,
    "src/modules/a/new.ts": lines(401),
    "src/modules/a/big.ts": lines(600),
    "src/modules/a/shrunk.ts": lines(430),
    "src/modules/a/small.ts": lines(100),
  };
  const result = lint(
    fixture,
    withRegistry({
      "src/modules/a/big.ts": { ceiling: 590, plan: "split" },
      "src/modules/a/shrunk.ts": { ceiling: 450, plan: "split" },
      "src/modules/a/small.ts": { ceiling: 450, plan: "split" },
      "src/modules/a/gone.ts": { ceiling: 450, plan: "split" },
    }),
  );
  // Inventory-wide findings (the stale `gone.ts` entry) attach to whichever file is walked first,
  // and the walk order is up to the file system: judge the small files by what is said about them.
  for (const file of ["ok.ts", "ok.vue"])
    expect(
      result.messages.filter((message) => message.includes(`src/modules/a/${file}`)),
      file,
    ).toStrictEqual([]);
  for (const file of ["new.ts", "big.ts", "shrunk.ts", "small.ts"]) {
    expect(result[`src/modules/a/${file}`]?.has("large-files"), file).toBeTruthy();
  }
  expect(Object.values(result).some((rules) => rules.has("large-files"))).toBeTruthy();
});

test("the real Projector tree satisfies its FEOD policy", () => {
  expect(checkFeod()).toStrictEqual([]);
});
