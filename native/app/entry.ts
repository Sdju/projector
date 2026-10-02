import { sessionBus } from "../modules/system-bus/index.ts";
import { available, shortcutStatus } from "../modules/desktop/index.ts";
import type { DesktopAction } from "../../core/modules/launcher/index.ts";

async function main() {
  const [command, value, action] = process.argv.slice(2);
  if (command === "native") {
    const { runResident } = await import("../modules/desktop/index.ts");
    await runResident(value, action as DesktopAction);
  } else if (command === "shortcut-check" || command === "shortcut-status") {
    const bus = sessionBus();
    try {
      console.log(
        JSON.stringify(
          command === "shortcut-check" ? await available(bus, value) : await shortcutStatus(bus),
        ),
      );
    } finally {
      bus.disconnect();
    }
  } else {
    const { listApplications, launchApplication, applicationIcon } =
      await import("../modules/desktop/index.ts");
    if (command === "list") console.log(JSON.stringify(listApplications()));
    else if (command === "launch") launchApplication(value);
    else if (command === "icon") console.log(await applicationIcon(value));
    else throw new Error("Неизвестная команда");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
