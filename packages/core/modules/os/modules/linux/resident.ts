import type { DesktopAction, DesktopPalette, ResidentOptions } from "../../contract.ts";
import dbus from "dbus-next";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionBus, call } from "./bus.ts";
import { Shortcut } from "./shortcut.ts";
import { startTray } from "./tray.ts";

const name = "dev.projector.Launcher";
const path = "/dev/projector/Launcher";
const iface = "dev.projector.Launcher.Control";
const actions: DesktopAction[] = ["show", "toggle", "tray", "quit"];

class Control extends dbus.interface.Interface {
  private dispatch: (action: DesktopAction) => Promise<void>;
  constructor(dispatch: (action: DesktopAction) => Promise<void>) {
    super(iface);
    this.dispatch = dispatch;
  }
  async Command(action: DesktopAction) {
    if (!actions.includes(action))
      throw new dbus.DBusError(`${iface}.Error`, "Неизвестная команда");
    await this.dispatch(action);
    return "READY";
  }
}
Control.configureMembers({ methods: { Command: { inSignature: "s", outSignature: "s" } } });

export async function runResident(
  baseUrl: string,
  action: DesktopAction,
  options: ResidentOptions,
) {
  if (!actions.includes(action)) throw new Error("Неизвестная команда");
  const bus = sessionBus();
  const owner = await bus.requestName(name, dbus.NameFlag.DO_NOT_QUEUE);
  if (owner !== dbus.RequestNameReply.PRIMARY_OWNER) {
    try {
      // A concurrent first invocation may own the name before exporting Control.
      for (let attempt = 0; ; attempt++) {
        try {
          await call(bus, name, path, iface, "Command", "s", [action]);
          break;
        } catch (error) {
          if (
            !(error instanceof dbus.DBusError) ||
            ![
              "org.freedesktop.DBus.Error.UnknownObject",
              "org.freedesktop.DBus.Error.UnknownMethod",
            ].includes(error.type) ||
            attempt >= 40
          )
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      console.log("READY");
    } finally {
      bus.disconnect();
    }
    return;
  }
  if (action === "quit") {
    console.log("READY");
    bus.disconnect();
    return;
  }
  let palette: Promise<DesktopPalette> | undefined;
  let pulse: ReturnType<typeof setTimeout> | undefined;
  const getPalette = () => (palette ??= createPalette());
  async function createPalette() {
    if (!options.webPalette) {
      const { default: Gtk } = await import("gi:Gtk-4.0");
      const { default: GLib } = await import("gi:GLib-2.0");
      Gtk.init();
      const context = GLib.MainContext.default();
      let lastActive = Date.now();
      const pump = () => {
        for (let step = 0; step < 64 && context.iteration(false); step++) lastActive = Date.now();
        pulse = setTimeout(pump, Date.now() - lastActive < 2000 ? 10 : 50);
      };
      pump();
    }
    return options.createPalette(baseUrl);
  }
  const invoke = (run: (palette: DesktopPalette) => void | Promise<void>) => {
    void getPalette()
      .then(run)
      .catch((error) => console.error("Палитра:", error.message));
  };
  let stopping = false;
  const shortcut = new Shortcut(
    bus,
    async () => {
      try {
        return (
          JSON.parse(await readFile(join(options.dataDirectory, "launcher.json"), "utf8"))
            .shortcut ?? "Ctrl+Alt+Space"
        );
      } catch {
        return "Ctrl+Alt+Space";
      }
    },
    () => {
      invoke((item) => item.invokeSelected(true));
    },
  );
  const removeTray = await startTray(
    bus,
    () => {
      invoke((item) => item.invokeSelected());
    },
    (path) => invoke((item) => item.openPage(path)),
    () => {
      invoke((item) => item.quitProjector());
    },
    () => {
      invoke((item) => item.restartProjector());
    },
  );
  await shortcut.start().catch((error) => console.error("Хоткей:", error.message));
  async function stop() {
    if (stopping) return;
    stopping = true;
    await shortcut.stop();
    if (palette) (await palette.catch(() => undefined))?.dispose();
    clearTimeout(pulse);
    removeTray();
    bus.disconnect();
  }
  const dispatch = async (requested: DesktopAction) => {
    if (requested === "quit") {
      // Send the D-Bus reply before closing its connection.
      setTimeout(() => {
        void stop();
      }, 50);
    } else if (requested === "tray") await shortcut.configure();
    else if (requested === "toggle") await (await getPalette()).toggle();
    else await (await getPalette()).show();
  };
  bus.export(path, new Control(dispatch));
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
  await dispatch(action);
  console.log("READY");
}
