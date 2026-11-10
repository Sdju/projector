import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compileSfc } from "@zede/vio/compiler";

/** Repository root: every published package builds from the workspace sources. */
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const PUBLISHED_SCOPE = "@ai-projector";
export const IDE_PACKAGE = `${PUBLISHED_SCOPE}/ide`;

/** Generated and packaging-only entries never end up inside an emitted tree. */
const SKIPPED = new Set([
  "node_modules",
  "scripts",
  "dist",
  "build",
  "package.json",
  "README.md",
  "LICENSE",
]);

/**
 * `externalCore` keeps core imports on the published add-on entrypoint instead of embedding core.
 * Relative paths are computed from the source layout, so destinations must keep the same distance
 * between packages (that is why published packages mirror `packages/<name>/...`).
 */
function rewrite(file, externalCore) {
  return (context) => {
    const visit = (node) => {
      if (ts.isStringLiteral(node)) {
        let path = node.text;
        if (path.startsWith("@ai-projector/core/")) {
          const suffix = path.slice("@ai-projector/core/".length);
          if (externalCore) path = `${IDE_PACKAGE}/core/${suffix}`;
          else {
            path = relative(dirname(file), join(root, "packages/core", suffix))
              .split(sep)
              .join("/");
            if (!path.startsWith(".")) path = "./" + path;
          }
        }
        // Only module/helper paths. A file filter such as [".ts", ".vue"] must stay intact.
        if (/^(\.\.?\/|@ai-projector\/)/.test(path))
          path = path.replace(/\.ts(?=\?|$)/, ".js").replace(/\.vue$/, ".vue.js");
        if (path !== node.text) return context.factory.createStringLiteral(path);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  };
}

/** Transpiles TypeScript and Vue sources from `directory` into `destination`. */
export async function emit(directory, destination, options = {}) {
  await emitDirectory(directory, destination, resolve(destination), options);
}

async function emitDirectory(directory, destination, outputRoot, { externalCore = false }) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name) || entry.name.endsWith(".d.ts")) continue;
    const sourcePath = join(directory, entry.name);
    // A caller may emit into its source tree; never traverse the generated destination.
    if (resolve(sourcePath) === outputRoot) continue;
    const targetPath = join(
      destination,
      entry.name.replace(/\.ts$/, ".js").replace(/\.vue$/, ".vue.js"),
    );
    if (entry.isDirectory()) {
      await emitDirectory(sourcePath, targetPath, outputRoot, { externalCore });
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
      transformers: { before: [rewrite(sourcePath, externalCore)] },
    }).outputText;
    await writeFile(targetPath, code);
  }
}

/** Copy of a repository directory into the package, e.g. `dist`, `resources` or `bin`. */
export function copy(from, to) {
  return cp(join(root, from), to, { recursive: true });
}

/** npm runs `bin` entries directly, so they need a shebang and the executable bit. */
export async function addShebang(file, mode = 0o755) {
  await writeFile(file, "#!/usr/bin/env node\n" + (await readFile(file, "utf8")));
  await chmod(file, mode);
}

/** The web interface is built once by `vp run build`; packages only copy the result. */
export async function ensureAppBuild() {
  await readFile(join(root, "dist/index.html")).catch(() => {
    throw new Error("Сначала выполните vp run build: нет dist/index.html");
  });
}
