import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compileSfc } from "@zede/vio/compiler";

// Preserve the runtime layout: child agents, MCP servers and OS helpers use import.meta.url.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "artifacts/distribution");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
// Published manifests contain exact installed catalog versions, never catalog:/workspace:.
const catalog = new Map();
for (const match of lock.matchAll(
  /^    (?:'([^']+)'|"([^"]+)"|([^\s:][^:]*)):\n      specifier: [^\n]+\n      version: ([^\n]+)/gm,
))
  catalog.set(match[1] ?? match[2] ?? match[3], match[4].replace(/^['"]|['"]$/g, ""));

async function dependencies(names, exclude = []) {
  const result = {};
  for (const name of names) {
    const pkg = JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8"));
    for (const dependency of Object.keys(pkg.dependencies)) {
      if (dependency.startsWith("@projector/") || exclude.includes(dependency)) continue;
      const version = catalog.get(dependency);
      if (!version) throw new Error(`No locked catalog version for ${dependency}`);
      result[dependency] = version;
    }
  }
  return result;
}

function rewrite(file, native) {
  return (context) => {
    const visit = (node) => {
      if (ts.isStringLiteral(node)) {
        let path = node.text;
        if (path.startsWith("@projector/core/")) {
          const suffix = path.slice("@projector/core/".length);
          if (native) path = `@projector/ide/core/${suffix}`;
          else {
            path = relative(dirname(file), join(root, "packages/core", suffix))
              .split(sep)
              .join("/");
            if (!path.startsWith(".")) path = "./" + path;
          }
        }
        // Only module/helper paths. A file filter such as [".ts", ".vue"] must stay intact.
        if (/^(\.\.?\/|@projector\/)/.test(path))
          path = path.replace(/\.ts(?=\?|$)/, ".js").replace(/\.vue$/, ".vue.js");
        if (path !== node.text) return context.factory.createStringLiteral(path);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  };
}

async function emit(directory, destination, native = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "package.json" ||
      entry.name.endsWith(".d.ts")
    )
      continue;
    const sourcePath = join(directory, entry.name);
    const targetPath = join(
      destination,
      entry.name.replace(/\.ts$/, ".js").replace(/\.vue$/, ".vue.js"),
    );
    if (entry.isDirectory()) {
      await emit(sourcePath, targetPath, native);
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    if (!/\.(ts|mjs|vue)$/.test(entry.name)) {
      await cp(sourcePath, targetPath);
      continue;
    }
    let code = await readFile(sourcePath, "utf8");
    if (entry.name.endsWith(".vue")) code = compileSfc(code, sourcePath);
    code = ts.transpileModule(code, {
      fileName: sourcePath.replace(/\.vue$/, ".ts"),
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
        allowJs: true,
      },
      transformers: { before: [rewrite(sourcePath, native)] },
    }).outputText;
    await writeFile(targetPath, code);
  }
}

await readFile(join(root, "dist/index.html"));
await rm(output, { recursive: true, force: true });
const ide = join(output, "ide");
const native = join(output, "native");
for (const name of ["core", "server", "cli"])
  await emit(join(root, "packages", name), join(ide, "packages", name));
await emit(join(root, "packages/native"), join(native, "packages/native"), true);
for (const name of ["dist", "resources", "bin", "LICENSE"])
  await cp(join(root, name), join(ide, name), { recursive: true });
await cp(join(root, "LICENSE"), join(native, "LICENSE"));
const common = {
  version: manifest.version,
  type: "module",
  license: manifest.license,
  repository: manifest.repository,
  engines: manifest.engines,
};
await writeFile(
  join(ide, "package.json"),
  JSON.stringify(
    {
      ...common,
      name: "@projector/ide",
      description: "Projector web IDE, terminals and agents without GTK",
      bin: { projector: "./packages/cli/app/launch.mjs" },
      exports: { "./core/*": "./packages/core/*" },
      dependencies: await dependencies(["core", "server"], ["vite", "vite-plus"]),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(native, "package.json"),
  JSON.stringify(
    {
      ...common,
      name: "@projector/native",
      description: "Optional GTK palette and GIO application catalog for Projector",
      exports: { "./entry": "./packages/native/app/entry.js" },
      dependencies: { "@projector/ide": manifest.version, ...(await dependencies(["native"])) },
    },
    null,
    2,
  ) + "\n",
);
// npm bin requires a shebang; the checkout also invokes this file through node directly.
const launch = join(ide, "packages/cli/app/launch.mjs");
await writeFile(launch, "#!/usr/bin/env node\n" + (await readFile(launch, "utf8")));
await chmod(launch, 0o755);
console.log(`Built @projector/ide and @projector/native in ${output}`);
