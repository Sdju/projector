import { os } from "@ai-projector/core/modules/os/index.ts";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import type { DesktopAction } from "@ai-projector/core/modules/os/index.ts";

export function runResident(baseUrl: string, action: DesktopAction) {
  return os.runDesktop(baseUrl, action, {
    dataDirectory: dataDir(),
    createPalette: async (url) => {
      const catalog = await os.catalog();
      const { Palette } = await import("./palette.ts");
      return new Palette(url, (id) => catalog.desktopApp(id).getIcon());
    },
  });
}
