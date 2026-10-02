import Gio from "gi:Gio-2.0";
import GioUnix from "gi:GioUnix-2.0";
import type { LaunchItem } from "../../../launcher/index.ts";

export function desktopApp(id: string) {
  const app = GioUnix.DesktopAppInfo.new(id);
  if (!app || !app.shouldShow()) throw new Error("Приложение больше не доступно");
  return app;
}
export function listApplications(): LaunchItem[] {
  return Gio.AppInfo.getAll()
    .filter((app) => app.shouldShow() && app.getId())
    .map((app) => {
      const id = app.getId()!;
      const desktop = GioUnix.DesktopAppInfo.new(id);
      return {
        id: `app:${id}`,
        name: app.getDisplayName(),
        description: app.getDescription() || "приложение",
        // Older GioUnix typelibs misclassify getKeywords as a static method.
        keywords: [app.getExecutable() || "", ...(desktop?.getLocaleString("Keywords") || "").split(";")].join(" "),
        kind: "application",
        icon: `/api/launcher/icon?id=${encodeURIComponent(id)}`,
      };
    });
}
export function launchApplication(id: string) {
  // GIO handles Exec field codes, Terminal=true and D-Bus activation.
  if (!desktopApp(id).launch([], new Gio.AppLaunchContext()))
    throw new Error("Не удалось запустить приложение");
}
export async function applicationIcon(id: string): Promise<string> {
  const icon = desktopApp(id).getIcon();
  if (icon instanceof Gio.FileIcon) return icon.getFile().getPath() || "";
  const { default: Gtk } = await import("gi:Gtk-4.0");
  const { default: Gdk } = await import("gi:Gdk-4.0");
  Gtk.init();
  const display = Gdk.Display.getDefault();
  if (!display || !icon) return "";
  return (
    Gtk.IconTheme.getForDisplay(display)
      .lookupByGicon(icon, 48, 1, Gtk.TextDirection.NONE, Gtk.IconLookupFlags.PRELOAD)
      .getFile()
      ?.getPath() || ""
  );
}
