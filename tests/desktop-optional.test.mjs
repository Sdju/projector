import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { serverCommand } from "../packages/core/modules/server-mode/index.ts";

const execute = promisify(execFile);

test("IDE window helpers import and resolve without any native package or GTK loader", async () => {
  const module = new URL("../packages/server/modules/window/desktop.ts", import.meta.url).href;
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import { registerHooks } from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({ resolve(name, context, next) {
      if (name.startsWith('@projector/native') || name.startsWith('@zede/vio') || name.startsWith('node-gtk') || name.startsWith('gi:'))
        throw Object.assign(new Error('Absent in IDE installation: ' + name), { code: 'MODULE_NOT_FOUND' });
      return next(name, context);
    }});
    import { basename, dirname } from 'node:path';
    const { desktopArgs, nativeArgs, hasNativePalette } = await import(${JSON.stringify(module)});
    assert.equal(hasNativePalette(), false);
    assert.equal(nativeArgs().length, 1);
    assert.equal(basename(nativeArgs()[0]), 'desktop.mjs');
    assert.equal(basename(dirname(dirname(nativeArgs()[0]))), 'cli');
    assert.deepEqual(desktopArgs(), nativeArgs());
    console.log('no GTK');
  `,
  ]);
  expect(stdout.trim()).toBe("no GTK");
});

test("packaged server runs compiled JavaScript without Vite", () => {
  expect(
    serverCommand("prod", { root: "/installed", node: "node", vp: "missing-vp", compiled: true }),
  ).toEqual({ command: "node", args: ["/installed/packages/server/app/standalone.js"] });
});

test.skipIf(process.platform !== "linux")(
  "tray, forwarding and quit work without GTK or a display",
  async () => {
    const { stdout } = await execute(
      "dbus-run-session",
      [
        "--",
        process.execPath,
        fileURLToPath(new URL("./fixtures/desktop-shell.mjs", import.meta.url)),
      ],
      { env: { ...process.env, DISPLAY: "", NODE_OPTIONS: "" }, timeout: 20000 },
    );
    expect(stdout).toContain("shell forwarding and cleanup passed without GTK");
  },
);
