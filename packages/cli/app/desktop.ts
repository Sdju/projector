import { os, type DesktopAction } from "@projector-ai/core/modules/os/index.ts";
import { dataDir } from "@projector-ai/core/modules/app-paths/index.ts";
import {
  createLauncherClient,
  type InterfaceMode,
} from "@projector-ai/core/modules/launcher/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function desktopAction(value: string | undefined): DesktopAction {
  if (value === "show" || value === "toggle" || value === "tray" || value === "quit") return value;
  throw new Error("Действие: show | toggle | tray | quit");
}

function installedMode(settings: { mode?: InterfaceMode }): InterfaceMode {
  return settings.mode === "window" ? "window" : "browser";
}

/** Desktop shell without the native palette. No GTK loader, even for tray and hotkey. */
async function main(): Promise<void> {
  const [command, value, action] = process.argv.slice(2);
  if (command === "native") {
    if (!value) throw new Error("Укажите адрес сервера");
    const client = createLauncherClient(value);
    const open = async (toggle = false) => {
      let settings: { mode?: InterfaceMode } = {};
      try {
        settings = JSON.parse(
          await readFile(join(dataDir(), "launcher.json"), "utf8"),
        ) as typeof settings;
      } catch {
        // Missing settings select the browser in the shell without GTK.
      }
      // The add-on can be installed while this resident is alive. An explicit web mode
      // prevents /app/open from forwarding back into this resident as a native request.
      await client.open(toggle, installedMode(settings));
    };
    await os.runDesktop(value, desktopAction(action), {
      dataDirectory: dataDir(),
      webPalette: true,
      createPalette: async () => ({
        show: () => open(),
        toggle: () => open(true),
        invokeSelected: open,
        openPage: (path: string) => os.windows.openBrowser(new URL(path, value).href),
        quitProjector: () => client.quit().then(() => undefined),
        restartProjector: () => client.restart().then(() => undefined),
        dispose() {},
      }),
    });
  } else if (command === "shortcut-check") {
    if (!value) throw new Error("Укажите сочетание клавиш");
    console.log(JSON.stringify(await os.shortcutAvailable(value)));
  } else if (command === "shortcut-status") console.log(JSON.stringify(await os.shortcutStatus()));
  else {
    if (os.capabilities.giLoader)
      throw new Error("Системные приложения требуют дополнения @projector-ai/native (GIO).");
    const catalog = await os.catalog();
    if (command === "list") console.log(JSON.stringify(await catalog.listApplications()));
    else if (command === "launch") {
      if (!value) throw new Error("Укажите приложение");
      await catalog.launchApplication(value);
    } else if (command === "icon") {
      if (!value) throw new Error("Укажите приложение");
      console.log(await catalog.applicationIcon(value));
    } else throw new Error("Неизвестная команда");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
