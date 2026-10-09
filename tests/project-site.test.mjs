import { expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { openProjectSiteFile } from "../server/modules/workspace/index.ts";

async function withSite(run) {
  const root = await mkdtemp(join(tmpdir(), "projector-site-"));
  try {
    await mkdir(join(root, "docs/css"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "docs/index.html"), "<h1>hi</h1>");
    await writeFile(join(root, "docs/css/a.css"), "h1{}");
    await writeFile(join(root, ".git/config"), "");
    const outside = join(root, "..", `${basename(root)}-outside.txt`);
    await writeFile(outside, "secret");
    await symlink(outside, join(root, "leak"));
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
    expect(css.type).toBe("text/css; charset=utf-8");
    const index = await openProjectSiteFile(root, "docs/");
    close(index);
    expect(index.type).toMatch(/^text\/html/);
  }));

test("a directory without a trailing slash redirects so relative links resolve", () =>
  withSite(async (root) => {
    expect(await openProjectSiteFile(root, "docs")).toStrictEqual({ redirect: true });
  }));

test("site files never leave the project or expose .git", () =>
  withSite(async (root) => {
    await expect(openProjectSiteFile(root, "leak")).rejects.toMatchObject({ status: 403 });
    await expect(openProjectSiteFile(root, "../x")).rejects.toMatchObject({ status: 403 });
    await expect(openProjectSiteFile(root, ".git/config")).rejects.toMatchObject({ status: 403 });
    await expect(openProjectSiteFile(root, "docs/missing.js")).rejects.toMatchObject({
      status: 404,
    });
  }));
