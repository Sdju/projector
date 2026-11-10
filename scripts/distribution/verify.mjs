#!/usr/bin/env node
/**
 * Self-check of `vp run build:distribution`, the last step of that script.
 *
 * The manifests are part of the workspace now, so this checks the invariants the workspace
 * cannot see: version lockstep, npm metadata, the built tree, and the tarballs npm would ship.
 * Packing goes through pnpm, which is what resolves `workspace:` and `catalog:` protocols.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../..", import.meta.url));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const rootManifest = await readJson(join(root, "package.json"));
const packages = {
  ide: await readJson(join(root, "packages/ide/package.json")),
  native: await readJson(join(root, "packages/native/package.json")),
  hub: await readJson(join(root, "packages/hub/package.json")),
};
const names = {
  ide: "@ai-projector/ide",
  native: "@ai-projector/native",
  hub: "@ai-projector/hub",
};

for (const [key, manifest] of Object.entries(packages)) {
  const label = names[key];
  check(manifest.name === label, `${key} name is ${manifest.name}, expected ${label}`);
  check(
    manifest.version === rootManifest.version,
    `${label} version ${manifest.version} != root ${rootManifest.version}`,
  );
  check(manifest.private !== true, `${label} must be publishable: remove private`);
  check(
    manifest.publishConfig?.access === "public",
    `${label} publishConfig.access must be public`,
  );
  check(
    manifest.publishConfig?.registry === "https://registry.npmjs.org/",
    `${label} publishConfig.registry must point to npmjs`,
  );
  check(
    manifest.repository?.url === rootManifest.repository?.url,
    `${label} repository.url must match the root repository for provenance`,
  );
  check(
    manifest.engines?.node === rootManifest.engines?.node,
    `${label} engines.node must match the root manifest`,
  );
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    check(
      !/^(file|link|portal):/.test(range),
      `${label} dependency ${dependency} uses a local protocol: ${range}`,
    );
    check(
      !range.startsWith("workspace:") || dependency.startsWith("@ai-projector/"),
      `${label} dependency ${dependency} must not use workspace:${range.slice(10)}`,
    );
  }
}
check(
  packages.native.dependencies?.[names.ide] === "workspace:*",
  `native must depend on ${names.ide} with workspace:* so pnpm pins the release version`,
);
check(
  packages.ide.bin?.projector === "./packages/cli/app/launch.js",
  "ide bin.projector must point to packages/cli/app/launch.js",
);
check(
  packages.ide.bin?.["projector-install-desktop"] === "./packages/cli/app/install-desktop.js",
  "ide bin.projector-install-desktop must point to packages/cli/app/install-desktop.js",
);
check(
  packages.hub.bin?.["projector-hub"] === "./packages/hub/app/main.js",
  "hub bin.projector-hub must point to packages/hub/app/main.js",
);

const required = [
  "packages/ide/dist/index.html",
  "packages/ide/packages/server/app/standalone.js",
  "packages/ide/packages/cli/app/launch.js",
  "packages/ide/packages/cli/app/install-desktop.js",
  "packages/ide/packages/cli/app/fix-node-pty.js",
  "packages/ide/packages/core/modules/os/index.js",
  "packages/ide/bin/projector",
  "packages/ide/resources/icons/projector.svg",
  "packages/ide/LICENSE",
  "packages/ide/README.md",
  "packages/native/dist/app/entry.js",
  "packages/native/dist/modules/desktop/Palette.vue.js",
  "packages/native/dist/modules/desktop/palette.js",
  "packages/native/LICENSE",
  "packages/native/README.md",
  "packages/hub/dist/index.html",
  "packages/hub/dist/hub.html",
  "packages/hub/packages/hub/app/main.js",
  "packages/hub/packages/hub/modules/gateway/gateway.js",
  "packages/hub/packages/core/modules/hub/index.js",
  "packages/hub/LICENSE",
  "packages/hub/README.md",
];
for (const file of required) {
  try {
    await access(join(root, file), constants.R_OK);
  } catch {
    failures.push(`missing ${file}`);
  }
}

for (const [label, file] of [
  ["ide launch", "packages/ide/packages/cli/app/launch.js"],
  ["ide install-desktop", "packages/ide/packages/cli/app/install-desktop.js"],
  ["hub main", "packages/hub/packages/hub/app/main.js"],
]) {
  const text = await readFile(join(root, file), "utf8").catch(() => "");
  check(text.startsWith("#!/usr/bin/env node\n"), `${label} must start with a Node shebang`);
}

/** Generated trees only: sources outside them are TypeScript and not shipped. */
const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};

const generated = [
  "packages/ide/packages",
  "packages/ide/dist",
  "packages/native/dist",
  "packages/hub/packages",
  "packages/hub/dist",
];
for (const directory of generated) {
  for (const file of await walk(join(root, directory))) {
    if (!/\.(js|mjs|json|ts)$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    if (text.includes("@projector/")) {
      failures.push(`${relative(root, file)} still references private scope @projector/`);
    }
    if (/@ai-projector\/(?:client|server|cli)\//.test(text)) {
      failures.push(`${relative(root, file)} references an unpublished workspace package`);
    }
  }
}

/**
 * Node never strips types inside `node_modules`, so a specifier that keeps `.ts`/`.vue` only
 * fails after install. The bundler output is skipped: it is not loaded by Node.
 */
const importTrees = ["packages/ide/packages", "packages/native/dist", "packages/hub/packages"];
for (const directory of importTrees) {
  for (const file of await walk(join(root, directory))) {
    if (!file.endsWith(".js")) continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"'\n]+)["']/g,
    )) {
      const specifier = match[1].split("?")[0].split("#")[0];
      const where = `${relative(root, file)}: ${specifier}`;
      if (/\.(ts|vue)$/.test(specifier)) {
        failures.push(`${where} is not transpiled`);
        continue;
      }
      await access(resolve(dirname(file), specifier)).catch(() => {
        failures.push(`${where} points to a missing module`);
      });
    }
  }
}

/**
 * Minimal tar reader: npm tarballs are gzipped ustar archives, and we only need entry names,
 * modes and the manifest bytes. Avoids depending on an external `tar` binary.
 */
function readTar(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    if (!name) break;
    const size = Number.parseInt(header.toString("utf8", 124, 136).replace(/\0.*$/, "").trim(), 8);
    const mode = Number.parseInt(header.toString("utf8", 100, 108).replace(/\0.*$/, "").trim(), 8);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    entries.set(name.replace(/\/$/, ""), { mode, data });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const pack = (directory, destination) =>
  new Promise((resolve, reject) =>
    execFile(
      "pnpm",
      ["pack", "--pack-destination", destination, "--json"],
      { cwd: join(root, directory), maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) =>
        error
          ? reject(new Error(`${directory}: ${error.message}`))
          : resolve(JSON.parse(stdout).filename),
    ),
  );

const tmp = await mkdtemp(join(tmpdir(), "projector-verify-"));
try {
  for (const key of Object.keys(packages)) {
    const label = names[key];
    let tarball;
    try {
      tarball = await pack(`packages/${key}`, tmp);
    } catch (error) {
      failures.push(`pack failed: ${error.message}`);
      continue;
    }
    const entries = readTar(gunzipSync(await readFile(tarball)));
    const packed = entries.get("package/package.json");
    if (!packed) {
      failures.push(`${label} tarball has no package/package.json`);
      continue;
    }
    const text = packed.data.toString("utf8");
    const published = JSON.parse(text);
    check(published.name === label, `${label} tarball name is ${published.name}`);
    check(
      published.version === rootManifest.version,
      `${label} tarball version ${published.version} != root ${rootManifest.version}`,
    );
    check(!text.includes("workspace:"), `${label} tarball manifest contains workspace:`);
    check(!text.includes("catalog:"), `${label} tarball manifest contains catalog:`);
    // pnpm turns `catalog:` into the declared semver range and `workspace:*` into the exact version.
    for (const [dependency, range] of Object.entries(published.dependencies ?? {})) {
      check(
        !/^(workspace|catalog|file|link|portal):/.test(range),
        `${label} tarball dependency ${dependency} kept a local protocol: ${range}`,
      );
      check(
        /^[\^~]?\d+\.\d+\.\d+/.test(range),
        `${label} tarball dependency ${dependency} has no version: ${range}`,
      );
    }
    if (key === "native") {
      check(
        published.dependencies?.[names.ide] === rootManifest.version,
        `${label} tarball must depend on ${names.ide}@${rootManifest.version}`,
      );
    }
    for (const [bin, target] of Object.entries(published.bin ?? {})) {
      const file = entries.get(`package/${target.replace(/^\.\//, "")}`);
      check(Boolean(file), `${label} bin ${bin} points to a missing file: ${target}`);
      check(
        file ? (file.mode & 0o111) === 0o111 : false,
        `${label} bin ${bin} is not executable in the tarball`,
      );
    }
    // Lifecycle hooks run for consumers: every `node <file>` target must be inside the tarball.
    for (const [name, command] of Object.entries(published.scripts ?? {})) {
      const target = /^node\s+(?:\.\/)?([^\s"']+)/.exec(command)?.[1];
      if (!target) continue;
      check(
        entries.has(`package/${target}`),
        `${label} script ${name} points to a missing file: ${target}`,
      );
    }
    const stray = [...entries.keys()].filter((name) => name.endsWith(".ts"));
    check(
      stray.length === 0,
      `${label} tarball ships TypeScript sources: ${stray.slice(0, 5).join(", ")}`,
    );
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error("Distribution verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Distribution OK: ${names.ide}@${rootManifest.version}, ${names.native}@${rootManifest.version}, ${names.hub}@${rootManifest.version}`,
);
