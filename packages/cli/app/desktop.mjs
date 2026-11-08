import { os } from "@projector/core/modules/os/index.ts";
import { dataDir } from "@projector/core/modules/app-paths/index.ts";
import { createLauncherClient } from "@projector/core/modules/launcher/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Desktop shell without the native palette. No GTK loader, even for tray and hotkey. */
async function main() {
  const [command, value, action] = process.argv.slice(2);
  if (command === "native") {
    const client = createLauncherClient(value);
    const open = async (toggle = false) => {
      let mode = "browser";
      try {
        const settings = JSON.parse(await readFile(join(dataDir(), "launcher.json"), "utf8"));
        if (settings.mode === "window") mode = "window";
      } catch {
        // Missing settings select the browser in the shell without GTK.
      }
      // The add-on can be installed while this resident is alive. An explicit web mode
      // prevents /app/open from forwarding back into this resident as a native request.
      await client.open(toggle, mode);
    };
    await os.runDesktop(value, action, {
      dataDirectory: dataDir(),
      webPalette: true,
      createPalette: async () => ({
        show: () => open(),
        toggle: () => open(true),
        invokeSelected: open,
        openPage: (path) => os.windows.openBrowser(new URL(path, value).href),
        quitProjector: () => client.quit().then(() => undefined),
        restartProjector: () => client.restart().then(() => undefined),
        dispose() {},
      }),
    });
  } else if (command === "shortcut-check")
    console.log(JSON.stringify(await os.shortcutAvailable(value)));
  else if (command === "shortcut-status") console.log(JSON.stringify(await os.shortcutStatus()));
  else {
    if (os.capabilities.giLoader)
      throw new Error("Системные приложения требуют дополнения @projector-ai/native (GIO).");
    const catalog = await os.catalog();
    if (command === "list") console.log(JSON.stringify(await catalog.listApplications()));
    else if (command === "launch") await catalog.launchApplication(value);
    else if (command === "icon") console.log(await catalog.applicationIcon(value));
    else throw new Error("Неизвестная команда");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
