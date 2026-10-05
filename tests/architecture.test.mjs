import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoundaries } from "../scripts/architecture-boundaries.mjs";
import {
  boundaryError,
  importsOf,
  checkArchitecture,
  largeFileErrors,
  moduleCycles,
} from "../scripts/check-architecture.mjs";

const transit = createBoundaries({
  src: { kind: "frontend", dependencies: ["core"], transitModules: ["tools"] },
  server: { kind: "backend", dependencies: ["core"], transitModules: ["tools"] },
  core: { kind: "library", dependencies: [], transitModules: ["tools"] },
}, "/fixture");

test("transit submodules are public through their own index, including across roots", () => {
  for (const [from, to] of [
    ["src/modules/workspace/ui.ts", "src/modules/tools/a/index.ts"],
    ["src/app/entry.ts", "src/modules/tools/a/index.ts"],
    ["src/modules/tools/b/ui.ts", "src/modules/tools/a/index.ts"],
    ["server/routes/api/usage.ts", "server/modules/tools/a/index.ts"],
    ["server/modules/tools/a/usage.ts", "core/modules/tools/a/index.ts"],
    ["src/modules/tools/a/ui.ts", "core/modules/tools/a/index.ts"],
    ["bootstrap.ts", "core/modules/tools/a/index.ts"],
  ]) assert.equal(transit.boundaryError(from, to), undefined, `${from} -> ${to}`);
  for (const [from, to] of [
    ["src/modules/workspace/ui.ts", "src/modules/tools/a/private.ts"],
    ["src/modules/tools/b/ui.ts", "src/modules/tools/a/private.ts"],
    ["server/modules/tools/a/usage.ts", "core/modules/tools/a/private.ts"],
    ["bootstrap.ts", "core/modules/tools/a/private.ts"],
  ]) assert.match(transit.boundaryError(from, to), /public index/, `${from} -> ${to}`);
});

test("transit private core is available only inside its own container and root", () => {
  const target = "src/modules/tools/_/polling.ts";
  for (const from of ["src/modules/tools/a/ui.ts", "src/modules/tools/_/cache.ts"])
    assert.equal(transit.boundaryError(from, target), undefined);
  for (const [from, to] of [
    ["src/modules/workspace/ui.ts", target],
    ["src/app/entry.ts", target],
    ["src/pages/index.vue", target],
    ["bootstrap.ts", target],
    ["src/modules/other/_/cache.ts", target],
    ["src/modules/tools/a/ui.ts", "core/modules/tools/_/types.ts"],
    ["server/modules/tools/a/usage.ts", "core/modules/tools/_/types.ts"],
    ["src/modules/tools/index.ts", target],
  ]) assert.match(transit.boundaryError(from, to), /private core/, `${from} -> ${to}`);
});

test("transit containers retain nested-module, layer and platform boundaries", () => {
  assert.equal(transit.boundaryError(
    "src/modules/tools/a/ui.ts", "src/modules/tools/a/modules/nested/index.ts",
  ), undefined);
  assert.equal(transit.boundaryError(
    "src/modules/tools/a/modules/nested/model.ts", "src/modules/tools/a/private.ts",
  ), undefined);
  for (const [from, to] of [
    ["src/modules/workspace/ui.ts", "src/modules/tools/index.ts"],
    ["src/modules/tools/b/ui.ts", "src/modules/tools/a/modules/nested/index.ts"],
    ["src/modules/tools/a/ui.ts", "src/modules/tools/a/modules/nested/private.ts"],
    ["src/common/utilities/date.ts", "src/modules/tools/a/index.ts"],
    ["src/modules/tools/a/ui.ts", "src/app/router.ts"],
    ["src/modules/tools/a/ui.ts", "server/modules/tools/a/index.ts"],
    ["src/modules/tools/a/ui.ts", "core/modules/os/index.ts"],
    ["core/modules/tools/a/index.ts", "core/modules/os/index.ts"],
  ]) assert.ok(transit.boundaryError(from, to), `${from} -> ${to}`);
});

test("transit adapters and private core have distinct owners so cycles remain visible", () => {
  const a = transit.classify("src/modules/tools/a/index.ts").module;
  const b = transit.classify("src/modules/tools/b/index.ts").module;
  const shared = transit.classify("src/modules/tools/_/polling.ts").module;
  assert.equal(new Set([a, b, shared]).size, 3);
  assert.equal(transit.classify("src/modules/tools/index.ts").module, undefined);
  assert.deepEqual(moduleCycles(new Map([[a, new Set([shared])], [b, new Set([shared])]])), []);
  for (const graph of [
    new Map([[a, new Set([b])], [b, new Set([a])]]),
    new Map([[a, new Set([shared])], [shared, new Set([a])]]),
  ]) assert.equal(moduleCycles(graph).length, 1);
});

test("all applications obey FEOD boundaries and have no module cycles", () => {
  assert.deepEqual(checkArchitecture().errors, []);
});
test("cross-module access requires public API, including app consumers", () => {
  assert.match(boundaryError("src/modules/a/model.ts", "src/modules/b/model.ts"), /public index/);
  assert.match(boundaryError("server/app/plugin.ts", "server/modules/b/store.ts"), /public index/);
  assert.equal(boundaryError("server/routes/api/test.ts", "server/modules/b/index.ts"), undefined);
});
test("upper layers, route/middleware siblings, globals and cross-app internals are isolated", () => {
  for (const [from, to] of [
    ["src/modules/a/index.ts", "src/app/router.ts"],
    ["src/common/utilities/date.ts", "src/modules/a/index.ts"],
    ["src/pages/index.vue", "src/pages/settings.vue"],
    ["server/routes/api/test.ts", "server/middlewares/origin.ts"],
    ["server/middlewares/origin.ts", "server/routes/api/test.ts"],
    ["src/app/entry.ts", "server/modules/projects/index.ts"],
    ["server/modules/a/index.ts", "native/modules/desktop/index.ts"],
    ["core/modules/a/index.ts", "src/modules/catalog/index.ts"],
    ["src/app/entry.ts", "src/globals/env.d.ts"],
  ])
    assert.ok(boundaryError(from, to), `${from} -> ${to}`);
});
test("nested modules have public API and may access parent implementation", () => {
  assert.equal(
    boundaryError("src/modules/a/index.ts", "src/modules/a/modules/b/index.ts"),
    undefined,
  );
  assert.ok(boundaryError("src/modules/other/index.ts", "src/modules/a/modules/b/index.ts"));
  assert.ok(boundaryError("src/modules/a/index.ts", "src/modules/a/modules/b/modules/c/index.ts"));
});
test("a submodule may use parent implementation", () => {
  assert.equal(
    boundaryError("src/modules/a/modules/b/index.ts", "src/modules/a/model.ts"),
    undefined,
  );
});
test("static, dynamic, require, reexport, type imports and both SFC script blocks are analyzed", () => {
  const code = `<script>export { x } from './private.ts'; const x = require('./other.ts');</script>
<script setup lang="ts">import type { X } from './types.ts';
const y = import('./dynamic.ts'); type Z = import('./type.ts').Z;
const hidden = import(variable); const other = require(variable);</script>`;
  const result = importsOf(code, "example.vue");
  assert.deepEqual(
    result.filter((x) => x.specifier).map((x) => x.specifier),
    ["./private.ts", "./other.ts", "./types.ts", "./dynamic.ts", "./type.ts"],
  );
  assert.equal(result.filter((x) => x.error).length, 2);
});

test("module cycles are rejected while a shared dependency stays acyclic", () => {
  assert.deepEqual(
    moduleCycles(
      new Map([
        ["a", new Set(["b"])],
        ["c", new Set(["b"])],
      ]),
    ),
    [],
  );
  assert.equal(
    moduleCycles(
      new Map([
        ["a", new Set(["b"])],
        ["b", new Set(["c"])],
        ["c", new Set(["a"])],
      ]),
    ).length,
    1,
  );
});

test("OS is Node-only and Linux implementation is private to its facade", () => {
  for (const consumer of ["src/modules/workspace/index.ts", "core/modules/launcher/index.ts"]) {
    assert.match(boundaryError(consumer, "core/modules/os/index.ts"), /Node OS/);
  }
  for (const consumer of [
    "server/modules/terminal/index.ts",
    "native/modules/desktop/index.ts",
    "cli/app/launch.mjs",
  ]) {
    assert.equal(boundaryError(consumer, "core/modules/os/index.ts"), undefined);
    assert.match(boundaryError(consumer, "core/modules/os/modules/linux/index.ts"), /private/);
    assert.match(boundaryError(consumer, "core/modules/os/modules/windows/index.ts"), /private/);
  }
});

test("literal native file-URL imports are checked, arbitrary URLs cannot bypass boundaries", () => {
  const result = importsOf(
    'const x = import(new URL("./catalog.ts", import.meta.url).href); const y = import(new URL(path, import.meta.url).href); const z = import(new URL("./catalog.ts", otherBase).href)',
    "loader.ts",
  );
  assert.deepEqual(
    result.filter((r) => r.specifier).map((r) => r.specifier),
    ["./catalog.ts"],
  );
  assert.equal(result.filter((r) => r.error).length, 2);
});
test("large-file registry is a ratchet with per-extension limits", () => {
  const registry = {
    thresholds: { default: 400, ".vue": 500 },
    files: {
      "a/Big.ts": { ceiling: 600, plan: "split" },
      "a/Gone.ts": { ceiling: 450, plan: "x" },
    },
  };
  assert.deepEqual(
    largeFileErrors(
      { "a/Big.ts": 600, "b/Ok.vue": 500, "b/Ok.ts": 400, "a/Gone.ts": 450 },
      registry,
    ),
    [],
  );
  const errors = largeFileErrors(
    { "a/Big.ts": 650, "b/New.vue": 501, "b/New.ts": 401, "a/Gone.ts": 380 },
    registry,
  );
  assert.equal(errors.length, 4);
  assert.match(errors.join("\n"), /Big\.ts: grew/);
  assert.match(errors.join("\n"), /New\.vue: 501/);
  assert.match(errors.join("\n"), /New\.ts: 401/);
  assert.match(errors.join("\n"), /Gone\.ts: now 380/);
  assert.match(largeFileErrors({ "a/Big.ts": 500 }, registry).join(), /lower its ceiling/);
});
