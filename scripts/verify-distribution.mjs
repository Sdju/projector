#!/usr/bin/env node
/**
 * Release gate for the two published npm packages. Run after build:distribution.
 * It checks the public names, versions, publish metadata and that no private
 * workspace specifier or old @projector/ scope leaked into the tarball contents.
 */
import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "artifacts/distribution");
const IDE_PACKAGE = "@projector-ai/ide";
const NATIVE_PACKAGE = "@projector-ai/native";
const failures = [];

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const rootManifest = await readJson(join(root, "package.json"));
const ide = await readJson(join(output, "ide/package.json"));
const native = await readJson(join(output, "native/package.json"));

check(ide.name === IDE_PACKAGE, `IDE package name is ${ide.name}, expected ${IDE_PACKAGE}`);
check(
  native.name === NATIVE_PACKAGE,
  `native package name is ${native.name}, expected ${NATIVE_PACKAGE}`,
);
check(
  ide.version === rootManifest.version,
  `IDE version ${ide.version} != root ${rootManifest.version}`,
);
check(
  native.version === rootManifest.version,
  `native version ${native.version} != root ${rootManifest.version}`,
);
check(ide.private !== true, "IDE package must not be private");
check(native.private !== true, "native package must not be private");
check(ide.publishConfig?.access === "public", "IDE publishConfig.access must be public");
check(native.publishConfig?.access === "public", "native publishConfig.access must be public");
check(
  ide.publishConfig?.registry === "https://registry.npmjs.org/",
  "IDE publishConfig.registry must point to npmjs",
);
check(
  native.publishConfig?.registry === "https://registry.npmjs.org/",
  "native publishConfig.registry must point to npmjs",
);
check(
  native.dependencies?.[IDE_PACKAGE] === rootManifest.version,
  `native must depend on ${IDE_PACKAGE}@${rootManifest.version}`,
);
check(
  ide.repository?.url === rootManifest.repository?.url,
  "IDE repository.url must match the root repository for provenance",
);
check(
  native.repository?.url === rootManifest.repository?.url,
  "native repository.url must match the root repository for provenance",
);
check(
  ide.bin?.projector === "./packages/cli/app/launch.mjs",
  "IDE bin.projector must point to launch.mjs",
);
check(
  ide.bin?.["projector-install-desktop"] === "./packages/cli/app/install-desktop.mjs",
  "IDE bin.projector-install-desktop must point to install-desktop.mjs",
);

for (const [label, manifest] of [
  ["IDE", ide],
  ["native", native],
]) {
  const text = JSON.stringify(manifest);
  check(!text.includes("workspace:"), `${label} manifest contains workspace:`);
  check(!text.includes("catalog:"), `${label} manifest contains catalog:`);
}

const required = [
  "ide/dist/index.html",
  "ide/packages/server/app/standalone.js",
  "ide/packages/cli/app/launch.mjs",
  "ide/packages/cli/app/install-desktop.mjs",
  "ide/packages/cli/app/fix-node-pty.mjs",
  "ide/bin/projector",
  "ide/resources/icons/projector.svg",
  "ide/LICENSE",
  "ide/README.md",
  "native/packages/native/app/entry.js",
  "native/LICENSE",
  "native/README.md",
];
for (const file of required) {
  try {
    await access(join(output, file), constants.R_OK);
  } catch {
    failures.push(`missing ${file}`);
  }
}

for (const [label, file] of [
  ["IDE launch", "ide/packages/cli/app/launch.mjs"],
  ["IDE install-desktop", "ide/packages/cli/app/install-desktop.mjs"],
]) {
  const text = await readFile(join(output, file), "utf8").catch(() => "");
  check(text.startsWith("#!/usr/bin/env node\n"), `${label} must start with a Node shebang`);
}

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};

for (const file of await walk(output)) {
  if (!/\.(js|mjs|json)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  if (text.includes("@projector/")) {
    failures.push(`${relative(output, file)} still references private scope @projector/`);
  }
}

if (failures.length) {
  console.error("Distribution verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Distribution OK: ${IDE_PACKAGE}@${ide.version}, ${NATIVE_PACKAGE}@${native.version}`);
