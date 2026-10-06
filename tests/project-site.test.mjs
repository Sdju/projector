import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectSiteFile } from "../server/modules/workspace/index.ts";

async function withSite(run) {
  const root = await mkdtemp(join(tmpdir(), "projector-site-"));
  try {
    await mkdir(join(root, "docs/css"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "docs/index.html"), "<h1>hi</h1>");
    await writeFile(join(root, "docs/css/a.css"), "h1{}");
    await writeFile(join(root, ".git/config"), "");
    await symlink("/etc/passwd", join(root, "leak"));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const close = (file) => "stream" in file && file.stream.destroy();

test("site files resolve inside the project with proper types", () =>
  withSite(async (root) => {
    const css = await openProjectSiteFile(root, "docs/css/a.css");
    close(css);
    assert.equal(css.type, "text/css; charset=utf-8");
    const index = await openProjectSiteFile(root, "docs/");
    close(index);
    assert.match(index.type, /^text\/html/);
  }));

test("a directory without a trailing slash redirects so relative links resolve", () =>
  withSite(async (root) => {
    assert.deepEqual(await openProjectSiteFile(root, "docs"), { redirect: true });
  }));

test("site files never leave the project or expose .git", () =>
  withSite(async (root) => {
    await assert.rejects(openProjectSiteFile(root, "leak"), { status: 403 });
    await assert.rejects(openProjectSiteFile(root, "../x"), { status: 403 });
    await assert.rejects(openProjectSiteFile(root, ".git/config"), { status: 403 });
    await assert.rejects(openProjectSiteFile(root, "docs/missing.js"), { status: 404 });
  }));
