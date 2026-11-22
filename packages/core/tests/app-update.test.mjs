import { expect, test } from "vite-plus/test";
import {
  detectInstallSource,
  IDE_PACKAGE,
  isNewer,
  managedByNpmFlag,
  npmLatestUrl,
  readNpmLatest,
  releaseNotesUrl,
  shouldNotifyInbox,
  shouldOfferUpdate,
  updateCommandText,
  updateCommands,
} from "../modules/app-update/index.ts";

test("checkout wins over a leftover npm marker", () => {
  expect(
    detectInstallSource({
      packageName: "projector",
      packagePath: "/src/projector",
      managedByNpm: true,
    }),
  ).toBe("checkout");
  expect(
    detectInstallSource({
      packageName: IDE_PACKAGE,
      packagePath: "/home/me/.local/lib/node_modules/@ai-projector/ide",
    }),
  ).toBe("npm");
  expect(
    detectInstallSource({
      packageName: IDE_PACKAGE,
      packagePath: String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\@ai-projector\ide`,
    }),
  ).toBe("npm");
  expect(
    detectInstallSource({
      packageName: IDE_PACKAGE,
      packagePath: "/tmp/extracted-ide",
      managedByNpm: true,
    }),
  ).toBe("npm");
  expect(
    detectInstallSource({
      packageName: IDE_PACKAGE,
      packagePath: "/tmp/extracted-ide",
    }),
  ).toBe("other");
  expect(managedByNpmFlag("1")).toBe(true);
  expect(managedByNpmFlag("0")).toBe(false);
  expect(managedByNpmFlag("maybe")).toBeUndefined();
});

test("npm latest is offered only with tarball and integrity", () => {
  const ready = {
    name: IDE_PACKAGE,
    version: "0.15.0",
    dist: {
      tarball: "https://registry.npmjs.org/@ai-projector/ide/-/ide-0.15.0.tgz",
      integrity: "sha512-abc",
    },
  };
  expect(readNpmLatest(ready, IDE_PACKAGE)).toEqual({
    name: IDE_PACKAGE,
    version: "0.15.0",
    tarball: ready.dist.tarball,
    integrity: "sha512-abc",
  });
  expect(() =>
    readNpmLatest({ ...ready, dist: { tarball: ready.dist.tarball } }, IDE_PACKAGE),
  ).toThrow(/integrity/);
  expect(() =>
    readNpmLatest(
      { ...ready, dist: { ...ready.dist, tarball: "http://registry.example/ide.tgz" } },
      IDE_PACKAGE,
    ),
  ).toThrow(/HTTPS/);
  expect(() => readNpmLatest({ ...ready, name: "@other/ide" }, IDE_PACKAGE)).toThrow(/пакет/);
  expect(npmLatestUrl(IDE_PACKAGE)).toBe("https://registry.npmjs.org/@ai-projector%2fide/latest");
});

test("the copied command pins the version and follows installed add-ons", () => {
  expect(isNewer("0.15.0", "0.14.0")).toBe(true);
  expect(isNewer("0.14.0", "0.14.0")).toBe(false);
  expect(isNewer("0.15.0", "0.15.0-beta.1")).toBe(true);
  expect(isNewer("0.15.0-beta.2", "0.15.0-beta.1")).toBe(true);
  expect(isNewer("0.15.0-beta.1", "0.15.0")).toBe(false);
  expect(updateCommandText(updateCommands({ latest: "0.15.0" }))).toBe(
    "npm install -g --allow-scripts=node-pty @ai-projector/ide@0.15.0",
  );
  expect(
    updateCommands({ latest: "v0.15.0", native: true, hub: true }).map((item) => item.command),
  ).toEqual([
    "npm install -g --allow-scripts=node-pty @ai-projector/ide@0.15.0",
    "npm install -g --allow-scripts=node-pty,node-gtk @ai-projector/native@0.15.0",
    "npm install -g @ai-projector/hub@0.15.0",
  ]);
  expect(releaseNotesUrl("0.15.0")).toContain("/v0.15.0");
});

test("checkout is never offered, dismiss sticks to one latest, inbox is npm-only", () => {
  const available = { current: "0.14.0", latest: "0.15.0" };
  expect(shouldOfferUpdate({ source: "checkout", ...available })).toBe(false);
  expect(shouldOfferUpdate({ source: "npm", ...available })).toBe(true);
  expect(shouldOfferUpdate({ source: "other", ...available })).toBe(true);
  expect(shouldNotifyInbox({ source: "npm", ...available, dismissed: "0.15.0" })).toBe(false);
  expect(shouldNotifyInbox({ source: "npm", ...available, dismissed: "0.14.1" })).toBe(true);
  expect(shouldNotifyInbox({ source: "other", ...available })).toBe(false);
  expect(shouldNotifyInbox({ source: "npm", ...available })).toBe(true);
});
