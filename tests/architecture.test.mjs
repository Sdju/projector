import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaryError,
  importsOf,
  checkArchitecture,
  moduleCycles,
} from "../scripts/check-architecture.mjs";

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
