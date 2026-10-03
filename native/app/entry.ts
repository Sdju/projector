import { os } from "../../core/modules/os/index.ts";
import type { DesktopAction } from "../../core/modules/os/index.ts";

async function main() {
  const [command, value, action] = process.argv.slice(2);
  if (command === "native") {
    os.requireSupported("native desktop");
    const { runResident } = await import("../modules/desktop/index.ts");
    await runResident(value, action as DesktopAction);
  } else if (command === "shortcut-check")
    console.log(JSON.stringify(await os.shortcutAvailable(value)));
  else if (command === "shortcut-status") console.log(JSON.stringify(await os.shortcutStatus()));
  else {
    const catalog = await os.catalog();
    if (command === "list") console.log(JSON.stringify(catalog.listApplications()));
    else if (command === "launch") catalog.launchApplication(value);
    else if (command === "icon") console.log(await catalog.applicationIcon(value));
    else throw new Error("Неизвестная команда");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
