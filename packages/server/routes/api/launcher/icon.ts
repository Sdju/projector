import { applicationIcon } from "../../../modules/launcher/index.ts";

import { sendIconFile, sendLetterIcon } from "../../../modules/project-presentation/index.ts";
import type { RouteDefinition } from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/launcher/icon",
    handler: async ({ res, url }) => {
      const id = url.searchParams.get("id") ?? "";
      const file = await applicationIcon(id).catch(() => null);
      if (file) sendIconFile(res, file);
      else sendLetterIcon(res, id);
    },
  },
];
