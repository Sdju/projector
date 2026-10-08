import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const nodeGtk = require.resolve("node-gtk/bin/node-gtk.js");
const wanted = ["Gtk-4.0", "GdkX11-4.0", "GdkWin32-4.0", "GioUnix-2.0"];
const outdir = join(process.cwd(), "node_modules", ".node-gtk-types");

const probe = spawnSync(
  process.execPath,
  [
    "--import",
    "node-gtk/register",
    "--input-type=module",
    "-e",
    `const wanted = ${JSON.stringify(wanted)};
const found = [];
for (const name of wanted) {
  try {
    await import("gi:" + name);
    found.push(name);
  } catch (error) {
    if (!/Typelib file for namespace/i.test(String(error && error.message))) throw error;
  }
}
process.stdout.write(found.join(" "));`,
  ],
  { encoding: "utf8" },
);
if (probe.status !== 0) {
  process.stderr.write(probe.stderr || probe.stdout);
  process.exit(probe.status ?? 1);
}
const found = probe.stdout.trim().split(/\s+/).filter(Boolean);
if (!found.includes("Gtk-4.0")) {
  process.stderr.write("node-gtk: Gtk-4.0 typelib is not available\n");
  process.exit(1);
}
const generated = spawnSync(
  process.execPath,
  [nodeGtk, "generate-types", ...found, "--no-docs", "--outdir", outdir],
  { stdio: "inherit" },
);
if (generated.status !== 0) process.exit(generated.status ?? 1);
const missing = wanted.filter((name) => !found.includes(name));
if (missing.length === 0) process.exit(0);
appendFileSync(
  join(outdir, "node-gtk.d.ts"),
  missing
    .map((name) => `declare module 'gi:${name}' { const ns: any; export default ns }\n`)
    .join(""),
);
