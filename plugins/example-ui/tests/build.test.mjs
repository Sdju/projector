import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, onTestFinished, test } from "vite-plus/test";
import {
  pluginCommandPrefix,
  validatePluginManifest,
} from "../../../packages/core/modules/plugins/index.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = join(root, "plugins/example-ui");

test("the example plugin builds alone and registers only declared contributions", async () => {
  const source = await mkdtemp(join(tmpdir(), "projector-independent-plugin-source-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  await cp(join(pluginRoot, "src"), join(source, "src"), { recursive: true });
  await cp(join(pluginRoot, "package.json"), join(source, "package.json"));
  const sdk = join(source, "node_modules/@ai-projector/plugin-api");
  await mkdir(join(source, "node_modules/@ai-projector"), { recursive: true });
  await cp(join(root, "packages/plugin-api"), sdk, {
    recursive: true,
    filter: (path) => !path.includes("node_modules"),
  });
  // Only the installed compiler and the public SDK are available; no Projector sources.
  await writeFile(
    join(source, "vite.config.mjs"),
    `export default {build:{target:'es2022',outDir:'dist',minify:false,lib:{entry:'src/browser.ts',formats:['es'],fileName:()=> 'browser.js'}}}`,
  );
  execFileSync("vp", ["build", "--config", "vite.config.mjs"], { cwd: source, stdio: "pipe" });
  const manifest = validatePluginManifest(
    JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8")),
  );
  expect(manifest.projector.browser).toBe("dist/browser.js");

  const artifact = await readFile(join(source, "dist/browser.js"), "utf8");
  // The artifact must not reach into the host sources, Vue, CodeMirror or TypeScript files.
  expect(artifact).not.toMatch(/packages\/client|packages\/server/);
  expect(artifact).not.toMatch(/from\s+["'][^"']*\.ts["']/);
  expect(artifact).not.toMatch(/\bvue\b|@codemirror/);

  // Load a copy outside the source directory: no node_modules or workspace resolves remain.
  const directory = await mkdtemp(join(tmpdir(), "projector-example-plugin-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await cp(join(source, "dist"), join(directory, "dist"), { recursive: true });
  const module = await import(pathToFileURL(join(directory, "dist/browser.js")).href);
  const registered = { languages: [], panels: [], tabs: [], commands: [] };
  const api = {
    apiVersion: 1,
    packageName: manifest.name,
    packageVersion: manifest.version,
    device: "",
    signal: new AbortController().signal,
    assetUrl: (path) => path,
    languages: {
      register: (contribution) => {
        registered.languages.push(contribution);
        return { dispose() {} };
      },
    },
    panels: {
      register: (contribution) => {
        registered.panels.push(contribution);
        return { dispose() {} };
      },
    },
    tabs: {
      register: (contribution) => {
        registered.tabs.push(contribution);
        return { dispose() {} };
      },
    },
    commands: {
      prefix: pluginCommandPrefix(manifest.name),
      register: (contribution) => {
        registered.commands.push(contribution);
        return { dispose() {} };
      },
    },
    onDispose() {},
  };
  expect(module.default.apiVersion).toBe(1);
  await module.default.activate(api);
  expect(registered.languages.map((item) => item.id)).toEqual(["fict"]);
  expect(registered.languages[0].rules.length).toBeGreaterThan(5);
  expect(registered.panels.map((item) => item.id)).toEqual(["inspector"]);
  expect(registered.tabs.map((item) => item.id)).toEqual(["overview"]);
  expect(registered.commands.map((item) => item.id)).toEqual([
    pluginCommandPrefix(manifest.name) + "greet",
  ]);
});
