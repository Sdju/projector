import { launchItem } from "../../../modules/launcher/index.ts";

import {
  json,
  readBody,
  asString,
  type RouteDefinition,
} from "../../../modules/transport/index.ts";

import type { LaunchActionId } from "@projector/core/modules/launcher/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/launcher/launch",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      const action = asString(body.action);
      if (
        action &&
        ![
          "launch",
          "open",
          "run",
          "stop",
          "browser",
          "window",
          "favorite",
          "import",
          "create",
          "folder",
        ].includes(action)
      )
        throw new Error("Неизвестное действие");
      json(
        res,
        200,
        await launchItem(
          asString(body.id),
          (action || undefined) as LaunchActionId | undefined,
          body.inline === true,
          asString(body.arg) || undefined,
        ),
      );
    },
  },
];
