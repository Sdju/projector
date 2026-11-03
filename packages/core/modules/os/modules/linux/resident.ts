import type { DesktopAction, ResidentOptions } from "../../contract.ts";
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
  const { default: Gtk } = await import("gi:Gtk-4.0");
  const { default: GLib } = await import("gi:GLib-2.0");
  Gtk.init();
  const loop = GLib.MainLoop.new(null, false);
  const palette = await options.createPalette(baseUrl);
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
      void palette.invokeSelected(true);
    },
  );
  const removeTray = await startTray(
    bus,
    () => {
      void palette.invokeSelected();
    },
    (path) => palette.openPage(path),
    () => {
      void palette.quitProjector();
    },
    () => {
      void palette.restartProjector();
    },
  );
  await shortcut.start().catch((error) => console.error("Хоткей:", error.message));
  async function stop() {
    if (stopping) return;
    stopping = true;
    await shortcut.stop();
    palette.dispose();
    removeTray();
    bus.disconnect();
    loop.quit();
  }
  const dispatch = async (requested: DesktopAction) => {
    if (requested === "quit") {
      // Send the D-Bus reply before closing its connection.
      setTimeout(() => {
        void stop();
      }, 50);
    } else if (requested === "tray") await shortcut.configure();
    else if (requested === "toggle") await palette.toggle();
    else await palette.show();
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
  loop.run();
}
