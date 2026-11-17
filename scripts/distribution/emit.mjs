import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { API, ModuleKind } from "typescript/async";
import { ScriptTarget, isStringLiteral } from "typescript/ast";
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

/** TypeScript 7 runs as a separate process; one instance serves every `emit` call in a build. */
let api;

function typescriptApi() {
  api ??= new API();
  return api;
}

/** Releases the TypeScript API process so a build script can exit. */
export async function closeEmit() {
  if (!api) return;
  const running = api;
  api = undefined;
  await running.close();
}

/**
 * `externalCore` keeps core imports on the published add-on entrypoint instead of embedding core.
 * Relative paths are computed from the source layout, so destinations must keep the same distance
 * between packages (that is why published packages mirror `packages/<name>/...`).
 */
function rewritePath(file, externalCore, path) {
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
  return path;
}

function collectEdits(node, file, externalCore, edits) {
  if (isStringLiteral(node)) {
    const path = rewritePath(file, externalCore, node.text);
    if (path !== node.text)
      edits.push({ start: node.getStart(), end: node.end, text: JSON.stringify(path) });
    return;
  }
  node.forEachChild((child) => collectEdits(child, file, externalCore, edits));
}

/**
 * TypeScript 7 has no compiler API in the `typescript` module: the native API parses files in its
 * own process, so only the ranges of module paths are rewritten and the source is kept as is.
 */
async function rewrite(file, code, externalCore) {
  const source = await typescriptApi().createSourceFile(file.replace(/\.vue$/, ".ts"), code);
  try {
    const edits = [];
    collectEdits(source.sourceFile, file, externalCore, edits);
    let out = "";
    let last = 0;
    for (const edit of edits.sort((left, right) => left.start - right.start)) {
      out += code.slice(last, edit.start) + edit.text;
      last = edit.end;
    }
    return out + code.slice(last);
  } finally {
    await source.dispose();
  }
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
    code = await rewrite(sourcePath, code, externalCore);
    code = (
      await typescriptApi().transpileModule(code, {
        fileName: sourcePath.replace(/\.vue$/, ".ts"),
        compilerOptions: {
          target: ScriptTarget.ES2023,
          module: ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          allowJs: true,
        },
      })
    ).outputText;
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
