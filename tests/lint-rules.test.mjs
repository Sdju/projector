import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
// The same Oxlint Vite+ bundles, so the test and `vp lint` never disagree on the plugin contract.
const vitePlusRequire = createRequire(import.meta.resolve("vite-plus/package.json"));
const oxlintBin = join(dirname(vitePlusRequire.resolve("oxlint/package.json")), "bin", "oxlint");
const plugin = fileURLToPath(new URL("../scripts/lint/projector-plugin.mjs", import.meta.url));
const RULE = "projector(no-direct-icon-import)";

/** Lints a temporary tree with only the project plugin enabled, like the architecture runner. */
function lint(files) {
  const directory = mkdtempSync(join(tmpdir(), "projector-lint-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const file = join(directory, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    const config = join(directory, "oxlint.json");
    writeFileSync(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [{ name: "projector", specifier: plugin }],
        rules: { "projector/no-direct-icon-import": "error" },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [oxlintBin, "--threads=1", "-c", config, "-f", "json", directory],
      { cwd: projectRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const stdout = result.stdout.trim();
    if (!stdout) throw new Error(`oxlint failed: ${result.stderr || result.status}`);
    return JSON.parse(stdout).diagnostics.filter((item) => item.code === RULE);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("direct icon imports, re-exports and lazy imports are reported", () => {
  const diagnostics = lint({
    "packages/client/modules/example/ui/Widget.ts": [
      'import IconX from "~icons/lucide/x";',
      'export { default as IconY } from "~icons/lucide/y";',
      'export const lazy = () => import("~icons/lucide/z");',
      "export const icon = IconX;",
    ].join("\n"),
  });
  expect(diagnostics).toHaveLength(3);
  for (const item of diagnostics) expect(item.message).toContain("ProjectorIcon");
});

test("a Vue script block is checked like a module", () => {
  const diagnostics = lint({
    "packages/client/modules/example/ui/Widget.vue": [
      '<script setup lang="ts">',
      'import IconX from "~icons/lucide/x";',
      "</script>",
      "<template><IconX /></template>",
    ].join("\n"),
  });
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].filename).toMatch(/Widget\.vue$/);
  expect(diagnostics[0].message).toContain("~icons/lucide/x");
});

test("the registry itself and unrelated imports stay clean", () => {
  const diagnostics = lint({
    "packages/client/common/icons/sets.ts": [
      'import IconX from "~icons/lucide/x";',
      "export const icons = { x: IconX };",
    ].join("\n"),
    "packages/client/modules/example/ui/Clean.vue": [
      '<script setup lang="ts">',
      'import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";',
      "</script>",
      '<template><ProjectorIcon name="x" /></template>',
    ].join("\n"),
  });
  expect(diagnostics).toEqual([]);
});
