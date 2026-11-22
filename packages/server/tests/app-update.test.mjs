import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { IDE_PACKAGE, NATIVE_PACKAGE } from "@ai-projector/core/modules/app-update/index.ts";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  appUpdateSnapshot,
  cacheIsFresh,
  fetchNpmLatest,
  findInstallRoot,
  readInstalledApp,
  readUpdateCache,
  writeUpdateCache,
} from "../modules/app-update/index.ts";

const previousData = process.env.XDG_DATA_HOME;
const previousMarker = process.env.PROJECTOR_MANAGED_BY_NPM;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-app-update-"));
  process.env.XDG_DATA_HOME = directory;
  delete process.env.PROJECTOR_MANAGED_BY_NPM;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousData;
  if (previousMarker === undefined) delete process.env.PROJECTOR_MANAGED_BY_NPM;
  else process.env.PROJECTOR_MANAGED_BY_NPM = previousMarker;
});

function npmLatest(version = "0.15.0") {
  return {
    name: IDE_PACKAGE,
    version,
    dist: {
      tarball: `https://registry.npmjs.org/@ai-projector/ide/-/ide-${version}.tgz`,
      integrity: "sha512-abc",
    },
  };
}

test("registry latest is offered only with HTTPS tarball and integrity", async () => {
  const load = async () =>
    new Response(JSON.stringify(npmLatest()), { headers: { "content-type": "application/json" } });
  await expect(fetchNpmLatest(IDE_PACKAGE, load)).resolves.toMatchObject({
    name: IDE_PACKAGE,
    version: "0.15.0",
    integrity: "sha512-abc",
  });
  const missing = async () =>
    new Response(JSON.stringify({ ...npmLatest(), dist: { tarball: npmLatest().dist.tarball } }));
  await expect(fetchNpmLatest(IDE_PACKAGE, missing)).rejects.toThrow(/integrity/);
  const oversized = async () =>
    new Response("{}", { headers: { "content-length": String(300 * 1024) } });
  await expect(fetchNpmLatest(IDE_PACKAGE, oversized)).rejects.toThrow(/слишком большой/);
});

test("update cache stays fresh for twenty hours and survives a broken file", async () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  expect(cacheIsFresh({}, now)).toBe(false);
  expect(cacheIsFresh({ checkedAt: "2026-11-20T00:00:00.000Z", latest: "0.15.0" }, now)).toBe(true);
  expect(cacheIsFresh({ checkedAt: "2026-11-19T12:00:00.000Z", latest: "0.15.0" }, now)).toBe(
    false,
  );
  await mkdir(dataDir(), { recursive: true });
  await writeFile(join(dataDir(), "update.json"), "{ broken", "utf8");
  expect(await readUpdateCache()).toEqual({});
  await writeUpdateCache({ checkedAt: "2026-11-20T00:00:00.000Z", latest: "0.15.0" });
  expect(await readUpdateCache()).toMatchObject({ latest: "0.15.0" });
});

test("checkout trees never copy an npm command even when latest is newer", async () => {
  const snapshot = appUpdateSnapshot(
    { source: "checkout", version: "0.14.0", path: "/src/projector" },
    { latest: "0.15.0" },
  );
  expect(snapshot).toMatchObject({
    source: "checkout",
    outdated: true,
    offer: false,
    inbox: false,
  });
  expect(snapshot.command).toBeUndefined();
  const npm = appUpdateSnapshot(
    {
      source: "npm",
      version: "0.14.0",
      path: "/home/me/.local/lib/node_modules/@ai-projector/ide",
      native: { name: "@ai-projector/native", version: "0.13.0" },
    },
    { latest: "0.15.0", nativeLatest: "0.15.0" },
  );
  expect(npm.offer).toBe(true);
  expect(npm.inbox).toBe(true);
  expect(npm.command).toContain("@ai-projector/ide@0.15.0");
  expect(npm.command).toContain("@ai-projector/native@0.15.0");
  expect(npm.native).toMatchObject({ lockstep: true });
  const dismissed = appUpdateSnapshot(
    { source: "npm", version: "0.14.0", path: "/prefix" },
    { latest: "0.15.0", dismissed: "0.15.0" },
  );
  expect(dismissed.offer).toBe(true);
  expect(dismissed.inbox).toBe(false);
  expect(dismissed.command).toContain("@ai-projector/ide@0.15.0");
});

test("install root follows the published package or the checkout name", async () => {
  const checkout = join(directory, "checkout");
  await mkdir(join(checkout, "packages/server/modules/app-update"), { recursive: true });
  await writeFile(
    join(checkout, "package.json"),
    JSON.stringify({ name: "projector", version: "0.14.0" }),
  );
  expect(
    readInstalledApp(findInstallRoot(join(checkout, "packages/server/modules/app-update"))),
  ).toMatchObject({ source: "checkout", version: "0.14.0" });

  const ide = join(directory, "node_modules/@ai-projector/ide");
  await mkdir(join(ide, "packages/cli/app"), { recursive: true });
  await writeFile(
    join(ide, "package.json"),
    JSON.stringify({ name: IDE_PACKAGE, version: "0.15.0" }),
  );
  const native = join(directory, "node_modules/@ai-projector/native");
  await mkdir(native, { recursive: true });
  await writeFile(
    join(native, "package.json"),
    JSON.stringify({ name: NATIVE_PACKAGE, version: "0.15.0" }),
  );
  expect(readInstalledApp(findInstallRoot(join(ide, "packages/cli/app")))).toMatchObject({
    source: "npm",
    version: "0.15.0",
    native: { name: NATIVE_PACKAGE, version: "0.15.0" },
  });
});
