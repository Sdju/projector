import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(projectRoot, "architecture.config.json"), "utf8"));
const extensions = [".ts", ".tsx", ".js", ".mjs", ".vue", ".json", ".css"];
const inside = (file, directory) => file === directory || file.startsWith(directory + sep);
const roots = Object.entries(config.roots).sort(([a], [b]) => b.length - a.length);

export function classify(file, base = projectRoot) {
  const absolute = resolve(base, file);
  for (const [root, options] of roots) {
    const directory = resolve(base, root);
    if (!inside(absolute, directory)) continue;
    const parts = relative(directory, absolute).split(sep);
    let module;
    let parentModule;
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === "modules" && parts[i + 1]) {
        parentModule = module;
        module = join(directory, ...parts.slice(0, i + 2));
      }
    }
    return { root, options, layer: parts[0], module, parentModule, absolute };
  }
  return { absolute };
}

export function boundaryError(from, to, base = projectRoot) {
  const source = classify(from, base);
  const target = classify(to, base);
  if (!target.root) return "Local dependency is outside the configured FEOD roots";
  if (
    (source.root === "src" ||
      (source.root === "core" &&
        !["app-paths", "os"].includes(
          relative(resolve(base, "core/modules"), source.absolute).split(sep)[0],
        ))) &&
    target.root === "core" &&
    ["app-paths", "os"].includes(
      relative(resolve(base, "core/modules"), target.absolute).split(sep)[0],
    )
  )
    return "Browser/domain code cannot consume Node OS infrastructure";
  if (target.layer === "globals") return "Globals are ambient declarations and cannot be imported";
  if (!source.root)
    return target.layer === "app" || target.layer === "modules"
      ? undefined
      : "Bootstrap may only consume app or public modules";
  if (source.layer === "globals") return "Globals cannot import application code";
  if (
    source.root !== target.root &&
    !source.options.dependencies.some((p) => inside(target.absolute, resolve(base, p)))
  )
    return "Dependency between these applications is forbidden";
  if (target.module && source.module !== target.module && target.module !== source.parentModule) {
    if (target.parentModule && source.module !== target.parentModule)
      return "A nested module is private to its parent";
    const publicFile = extname(target.module) ? target.module : join(target.module, "index.ts");
    if (target.absolute !== publicFile) return "Use the module public index.ts";
  }
  if (source.root !== target.root && target.layer !== "modules")
    return "Applications may only consume public modules from another root";
  if (source.layer === "common" && !["common"].includes(target.layer))
    return "Common cannot depend on business modules or upper layers";
  if (source.layer === "modules" && !["modules", "common"].includes(target.layer))
    return "Modules cannot import routes, middleware, pages or app";
  if (
    ["pages", "routes", "middlewares"].includes(source.layer) &&
    !["modules", "common"].includes(target.layer)
  )
    return "Pages, routes and middleware are isolated; compose them in app";
}

export function importsOf(code, file) {
  const blocks = file.endsWith(".vue")
    ? [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    : [code];
  const imports = [];
  for (const block of blocks) {
    const ast = ts.createSourceFile(file, block, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        specifier = node.argument.literal;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        specifier = node.arguments[0];
        // Native loaders use a literal file URL so config bundling cannot hoist GI
        // imports into Vite. Resolve the URL as a normal dependency; no arbitrary imports.
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          specifier &&
          ts.isPropertyAccessExpression(specifier) &&
          specifier.name.text === "href" &&
          ts.isNewExpression(specifier.expression) &&
          ts.isIdentifier(specifier.expression.expression) &&
          specifier.expression.expression.text === "URL"
        ) {
          const args = specifier.expression.arguments;
          if (
            args?.length === 2 &&
            ts.isStringLiteralLike(args[0]) &&
            args[0].text.startsWith(".") &&
            args[1].getText(ast) === "import.meta.url"
          )
            specifier = args[0];
        }
        if (!specifier || !ts.isStringLiteralLike(specifier))
          imports.push({ error: "Computed imports/require bypass architecture boundaries" });
      }
      if (specifier && ts.isStringLiteralLike(specifier))
        imports.push({
          specifier: specifier.text,
          typeOnly: Boolean(
            node.isTypeOnly || node.importClause?.isTypeOnly || ts.isImportTypeNode(node),
          ),
        });
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return imports;
}

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
function resolveImport(file, specifier) {
  const value = specifier.split("?")[0];
  let target;
  if (value.startsWith(".")) target = resolve(dirname(file), value);
  else if (value.startsWith("/")) target = resolve(projectRoot, "." + value);
  else {
    const alias = Object.keys(config.aliases).find((a) => value === a || value.startsWith(a + "/"));
    if (alias) target = resolve(projectRoot, config.aliases[alias] + value.slice(alias.length));
    else return;
  }
  const candidates = [
    target,
    ...extensions.map((e) => target + e),
    ...extensions.map((e) => join(target, "index" + e)),
  ];
  const found = candidates.find((p) => existsSync(p) && !readdirIsDirectory(p));
  return found ? realpathSync(found) : { error: `Unresolved local import: ${specifier}` };
}
function readdirIsDirectory(file) {
  try {
    readdirSync(file);
    return true;
  } catch {
    return false;
  }
}

export function moduleCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const active = [];
  function visit(module) {
    if (active.includes(module)) {
      cycles.push(
        "Module cycle: " +
          [...active.slice(active.indexOf(module)), module]
            .map((p) => relative(projectRoot, p))
            .join(" -> "),
      );
      return;
    }
    if (visited.has(module)) return;
    active.push(module);
    for (const dependency of graph.get(module) ?? []) visit(dependency);
    active.pop();
    visited.add(module);
  }
  for (const module of graph.keys()) visit(module);
  return cycles;
}

const lineCount = (file) => readFileSync(file, "utf8").split("\n").length - 1;
const isSource = (file) => /\.(?:[cm]?js|tsx?|vue|py)$/.test(file);

const sizeLimit = (file, registry) =>
  registry.thresholds[extname(file)] ?? registry.thresholds.default;

// Large-file registry: a file over the threshold must be listed with a ceiling and a split plan.
// The ceiling only goes down, so a registered file cannot keep growing unnoticed.
export function largeFileErrors(sizes, registry = config.largeFiles) {
  if (!registry) return [];
  const errors = [];
  const listed = registry.files ?? {};
  for (const [file, lines] of Object.entries(sizes)) {
    const entry = listed[file];
    const limit = sizeLimit(file, registry);
    if (lines > limit && !entry)
      errors.push(
        `${file}: ${lines} lines exceed ${limit}; add it to largeFiles with a split plan or split it`,
      );
    else if (entry && lines > entry.ceiling)
      errors.push(
        `${file}: grew to ${lines} lines, registry ceiling is ${entry.ceiling}; split it instead of growing`,
      );
  }
  for (const [file, entry] of Object.entries(listed)) {
    if (!(file in sizes))
      errors.push(`${file}: listed in largeFiles but does not exist; remove the entry`);
    else if (sizes[file] <= sizeLimit(file, registry))
      errors.push(
        `${file}: now ${sizes[file]} lines, within ${sizeLimit(file, registry)}; remove it from largeFiles`,
      );
    else if (sizes[file] < entry.ceiling)
      errors.push(
        `${file}: shrank to ${sizes[file]} lines; lower its ceiling from ${entry.ceiling}`,
      );
  }
  return errors;
}

export function largeFilesMarkdown(sizes, registry = config.largeFiles) {
  const rows = Object.entries(registry.files)
    .sort(([, a], [, b]) => b.ceiling - a.ceiling)
    .map(([file, e]) => `| \`${file}\` | ${sizes[file] ?? "—"} | ${e.ceiling} | ${e.plan} |`);
  return [
    "# Реестр больших файлов",
    "",
    "Файл живёт здесь, пока в нём больше " +
      registry.thresholds.default +
      " строк (для `.vue` — " +
      registry.thresholds[".vue"] +
      "). Реестр хранится в `largeFiles` файла `architecture.config.json`; эту таблицу создаёт `vp run architecture -- --registry`. `scripts/check-architecture.mjs` требует запись для каждого файла выше порога, запрещает рост выше потолка и просит снизить потолок или удалить запись после сокращения файла.",
    "",
    "| Файл | Строк | Потолок | План разбиения |",
    "| --- | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function checkArchitecture() {
  const errors = [];
  const sizes = {};
  const graph = new Map();
  const files = roots.flatMap(([root]) => filesIn(join(projectRoot, root)));
  for (const file of files) {
    const own = classify(file);
    const allowed =
      own.options.kind === "backend"
        ? ["app", "routes", "middlewares", "modules", "globals"]
        : own.options.kind === "frontend"
          ? ["app", "pages", "modules", "common", "globals"]
          : ["app", "modules", "globals"];
    const report = (message) => errors.push(`${relative(projectRoot, file)}: ${message}`);
    if (!allowed.includes(own.layer)) report(`Unknown FEOD layer: ${own.layer}`);
    if (own.layer === "common" && /^index\./.test(file.split(sep).at(-1)))
      report("Common must not have barrel indexes");
    if (own.layer === "globals" && !file.endsWith(".d.ts"))
      report("Globals may only contain ambient declarations");
    if (own.module && ["common", "shared", "utils"].includes(own.module.split(sep).at(-1)))
      report("Modules must have a concrete responsibility");
    if (own.module && !existsSync(join(own.module, "index.ts")) && !extname(own.module))
      report("Module must have a public index.ts");
    if (isSource(file)) sizes[relative(projectRoot, file)] = lineCount(file);
    if (!/\.(?:[cm]?js|tsx?|vue)$/.test(file)) continue;
    const code = readFileSync(file, "utf8");
    if (
      !inside(file, join(projectRoot, "core/modules/os/modules/linux")) &&
      /["'`]\/proc(?:\/|["'`])|["'](?:xdotool|xprop|wmctrl|org\.kde\.[^"']*)["']/.test(code)
    )
      report("Linux-specific operations must live in the os Linux adapter");
    for (const dependency of importsOf(readFileSync(file, "utf8"), file)) {
      if (dependency.error) {
        report(dependency.error);
        continue;
      }
      const specifier = dependency.specifier;
      // Node-only infrastructure is confined to app-paths and os.
      if (
        (own.root === "src" ||
          (own.root === "core" &&
            !file.includes("/app-paths/") &&
            !file.includes("/modules/os/"))) &&
        (/^node:/.test(specifier) ||
          ["node-gtk", "dbus-next", "node-pty", "ws"].includes(specifier))
      )
        report(`Platform dependency in browser/domain code: ${specifier}`);

      const target = resolveImport(file, specifier);
      if (!target) continue;
      if (target.error) {
        report(target.error);
        continue;
      }
      const error = boundaryError(file, target);
      if (error) report(`${error}: ${specifier}`);
      const targetOwner = classify(target).module;
      if (
        own.module &&
        targetOwner &&
        own.module !== targetOwner &&
        !(dependency.typeOnly && inside(own.module, targetOwner))
      ) {
        if (!graph.has(own.module)) graph.set(own.module, new Set());
        graph.get(own.module).add(targetOwner);
      }
    }
  }
  errors.push(...moduleCycles(graph));
  errors.push(...largeFileErrors(sizes));
  return {
    errors,
    sizes,
    files: files.length,
    modules: new Set(files.map((p) => classify(p).module).filter(Boolean)).size,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture();
  if (process.argv.includes("--registry"))
    writeFileSync(join(projectRoot, "docs/large-files.md"), largeFilesMarkdown(result.sizes));
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `FEOD: ${result.files} files, ${result.modules} modules; boundaries and dependency cycles checked.`,
    );
}
