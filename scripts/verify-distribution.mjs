#!/usr/bin/env node
/**
 * Release gate for the published npm packages. Run after build:distribution.
 * It checks the public names, versions, publish metadata and that no private
 * workspace specifier or old @projector/ scope leaked into the tarball contents.
 */
import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "artifacts/distribution");
const IDE_PACKAGE = "@ai-projector/ide";
const NATIVE_PACKAGE = "@ai-projector/native";
const HUB_PACKAGE = "@ai-projector/hub";
const failures = [];

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const rootManifest = await readJson(join(root, "package.json"));
const ide = await readJson(join(output, "ide/package.json"));
const native = await readJson(join(output, "native/package.json"));
const hub = await readJson(join(output, "hub/package.json"));

check(ide.name === IDE_PACKAGE, `IDE package name is ${ide.name}, expected ${IDE_PACKAGE}`);
check(
  native.name === NATIVE_PACKAGE,
  `native package name is ${native.name}, expected ${NATIVE_PACKAGE}`,
);
check(hub.name === HUB_PACKAGE, `hub package name is ${hub.name}, expected ${HUB_PACKAGE}`);
for (const [label, packageManifest] of [
  ["IDE", ide],
  ["native", native],
  ["hub", hub],
]) {
  check(
    packageManifest.version === rootManifest.version,
    `${label} version ${packageManifest.version} != root ${rootManifest.version}`,
  );
  check(packageManifest.private !== true, `${label} package must not be private`);
  check(
    packageManifest.publishConfig?.access === "public",
    `${label} publishConfig.access must be public`,
  );
  check(
    packageManifest.publishConfig?.registry === "https://registry.npmjs.org/",
    `${label} publishConfig.registry must point to npmjs`,
  );
  check(
    packageManifest.repository?.url === rootManifest.repository?.url,
    `${label} repository.url must match the root repository for provenance`,
  );
  const text = JSON.stringify(packageManifest);
  check(!text.includes("workspace:"), `${label} manifest contains workspace:`);
  check(!text.includes("catalog:"), `${label} manifest contains catalog:`);
}
check(
  native.dependencies?.[IDE_PACKAGE] === rootManifest.version,
  `native must depend on ${IDE_PACKAGE}@${rootManifest.version}`,
);
check(
  ide.bin?.projector === "./packages/cli/app/launch.js",
  "IDE bin.projector must point to launch.js",
);
check(
  ide.bin?.["projector-install-desktop"] === "./packages/cli/app/install-desktop.js",
  "IDE bin.projector-install-desktop must point to install-desktop.js",
);
check(
  hub.bin?.["projector-hub"] === "./packages/hub/app/main.js",
  "hub bin.projector-hub must point to main.js",
);

const required = [
  "ide/dist/index.html",
  "ide/packages/server/app/standalone.js",
  "ide/packages/cli/app/launch.js",
  "ide/packages/cli/app/install-desktop.js",
  "ide/packages/cli/app/fix-node-pty.js",
  "ide/bin/projector",
  "ide/resources/icons/projector.svg",
  "ide/LICENSE",
  "ide/README.md",
  "native/packages/native/app/entry.js",
  "native/LICENSE",
  "native/README.md",
  "hub/dist/index.html",
  "hub/dist/hub.html",
  "hub/packages/hub/app/main.js",
  "hub/packages/hub/modules/gateway/gateway.js",
  "hub/packages/core/modules/hub/index.js",
  "hub/LICENSE",
  "hub/README.md",
];
for (const file of required) {
  try {
    await access(join(output, file), constants.R_OK);
  } catch {
    failures.push(`missing ${file}`);
  }
}

for (const [label, file] of [
  ["IDE launch", "ide/packages/cli/app/launch.js"],
  ["IDE install-desktop", "ide/packages/cli/app/install-desktop.js"],
  ["hub main", "hub/packages/hub/app/main.js"],
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
  if (!/\.(js|mjs|json|ts)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  if (text.includes("@projector/")) {
    failures.push(`${relative(output, file)} still references private scope @projector/`);
  }
  if (/@ai-projector\/(?:client|server|cli)\//.test(text)) {
    failures.push(`${relative(output, file)} references an unpublished workspace package`);
  }
}

if (failures.length) {
  console.error("Distribution verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Distribution OK: ${IDE_PACKAGE}@${ide.version}, ${NATIVE_PACKAGE}@${native.version}, ${HUB_PACKAGE}@${hub.version}`,
);
