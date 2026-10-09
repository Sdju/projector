// Runs outside Vitest, with the `gi:` loader: which GTK call really removes a window on macOS.
import { execFileSync } from "node:child_process";
import { ensureHelperSync } from "../../core/modules/os/modules/darwin/shell.ts";

const { default: Gtk } = await import("gi:Gtk-4.0");
const { default: GLib } = await import("gi:GLib-2.0");
Gtk.init();
const context = GLib.MainLoop.new(null, false).getContext();
const pump = async (ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    while (context.iteration(false));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const count = () =>
  Number(
    /windows:(\d+)/.exec(
      execFileSync(ensureHelperSync(), ["--windows", String(process.pid)], { encoding: "utf8" }),
    )[1],
  );
const result = {};
for (const [name, remove] of [
  ["hide", (w) => w.hide()],
  ["setVisible", (w) => w.setVisible(false)],
  ["close", (w) => w.close()],
  ["destroy", (w) => w.destroy()],
]) {
  const window = new Gtk.Window();
  window.setTitle(`Hide ${name}`);
  window.setDefaultSize(320, 200);
  window.present();
  await pump(1500);
  const shown = count();
  remove(window);
  await pump(1500);
  result[name] = { shown, after: count() };
}
console.log(JSON.stringify(result));
process.exit(0);
