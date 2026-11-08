import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compileSfc } from "@zede/vio/compiler";

// Preserve the runtime layout: child agents, MCP servers and OS helpers use import.meta.url.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "artifacts/distribution");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
// Internal workspace packages stay private under @projector/*; only these two go to npm.
const PUBLISHED_SCOPE = "@projector-ai";
const IDE_PACKAGE = `${PUBLISHED_SCOPE}/ide`;
const NATIVE_PACKAGE = `${PUBLISHED_SCOPE}/native`;
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
          if (native) path = `${IDE_PACKAGE}/core/${suffix}`;
          else {
            path = relative(dirname(file), join(root, "packages/core", suffix))
              .split(sep)
              .join("/");
            if (!path.startsWith(".")) path = "./" + path;
          }
        } else if (path.startsWith("@projector/")) {
          // The add-on is a separate published package: the IDE must resolve its public name.
          const suffix = path.slice("@projector/".length);
          path = `${PUBLISHED_SCOPE}/${suffix}`;
        }
        // Only module/helper paths. A file filter such as [".ts", ".vue"] must stay intact.
        if (/^(\.\.?\/|@projector\/|@projector-ai\/)/.test(path))
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
  homepage: manifest.homepage,
  bugs: manifest.bugs,
  engines: manifest.engines,
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org/",
  },
};

const ideReadme = `# ${IDE_PACKAGE}

Projector web IDE: files, Git, terminals and agent chats in one local server. This package does not include the GTK palette.

## Install

\`\`\`bash
npm install -g ${IDE_PACKAGE}
projector --browser
\`\`\`

Open <http://localhost:4177> while Projector is running. Without \`${NATIVE_PACKAGE}\` the default launch mode opens the browser.

The CLI can drive projects without the UI:

\`\`\`bash
projector open ~/code/app       # registers and opens a folder as a project
projector projects              # saved projects
projector status .              # server, project and process state
projector run . --command dev   # start the project command
projector stop .
projector search opencode
projector start | restart | quit
\`\`\`

Use \`--json\` for machine-readable output. \`projector open\` also accepts a project id or name, \`gh:/owner/repository\` and \`gl:/<instance>/<group>/<project>\`.

Requirements: Node.js 24.11–24.x; on Linux, Python 3, \`make\` and a C++ compiler to build \`node-pty\`. Projector also uses \`git\`, \`rg\` and GNU \`mv\`.

To add a desktop entry and the \`projector\` command:

\`\`\`bash
projector-install-desktop
\`\`\`

Data and settings are stored in \`$XDG_DATA_HOME/projector\` (\`~/.local/share/projector\` by default).
`;

const nativeReadme = `# ${NATIVE_PACKAGE}

Optional GTK palette and GIO application catalog for Projector. Install it in the same npm prefix as \`${IDE_PACKAGE}\`.

## Install

\`\`\`bash
npm install -g ${NATIVE_PACKAGE}
projector --native
\`\`\`

Requirements: the IDE package of the same version, GTK4, GObject Introspection, \`pkg-config\` and a C++ compiler for \`node-gtk\`. On Linux, install the GTK4 development packages before npm install.

The GTK palette runs in a separate helper process. Without this package Projector opens the browser and keeps the tray/hotkey resident without GTK.
`;

await writeFile(join(ide, "README.md"), ideReadme);
await writeFile(join(native, "README.md"), nativeReadme);
await writeFile(
  join(ide, "package.json"),
  JSON.stringify(
    {
      ...common,
      name: IDE_PACKAGE,
      description: "Projector web IDE, terminals and agents without GTK",
      keywords: ["projector", "ide", "terminal", "agents", "workspace"],
      bin: {
        projector: "./packages/cli/app/launch.js",
        "projector-install-desktop": "./packages/cli/app/install-desktop.js",
      },
      scripts: { postinstall: "node ./packages/cli/app/fix-node-pty.js" },
      exports: { "./core/*": "./packages/core/*" },
      files: ["bin", "dist", "packages", "resources", "LICENSE", "README.md"],
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
      name: NATIVE_PACKAGE,
      description: "Optional GTK palette and GIO application catalog for Projector",
      keywords: ["projector", "gtk", "palette", "gio"],
      exports: { "./entry": "./packages/native/app/entry.js" },
      files: ["packages", "LICENSE", "README.md"],
      dependencies: {
        [IDE_PACKAGE]: manifest.version,
        ...(await dependencies(["native"])),
      },
    },
    null,
    2,
  ) + "\n",
);
// npm bin requires a shebang; the checkout also invokes these files through node directly.
for (const [file, mode] of [
  [join(ide, "packages/cli/app/launch.js"), 0o755],
  [join(ide, "packages/cli/app/install-desktop.js"), 0o755],
]) {
  await writeFile(file, "#!/usr/bin/env node\n" + (await readFile(file, "utf8")));
  await chmod(file, mode);
}
console.log(`Built ${IDE_PACKAGE} and ${NATIVE_PACKAGE} in ${output}`);
