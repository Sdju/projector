import type { AppearanceChoice } from "@ai-projector/core/modules/appearance/index.ts";
import { readAppearanceChoice, writeAppearanceChoice } from "../../modules/appearance/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";

/**
 * A blocking classic script in <head>: it applies the saved scheme before the app and styles paint.
 * The response is built per request, so changing the theme needs neither a rebuild nor a page reload.
 */
function bootstrapScript(choice: AppearanceChoice): string {
  return `(() => {
  const choice = ${JSON.stringify(choice)};
  const root = document.documentElement;
  const scheme =
    choice === "auto"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : choice;
  const mode = scheme === "light" ? "light" : "dark";
  root.dataset.appearance = choice;
  root.dataset.theme = scheme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
})();
`;
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/appearance/bootstrap.js",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.end(bootstrapScript(await readAppearanceChoice()));
    },
  },
  {
    method: "GET",
    path: "/api/appearance",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { choice: await readAppearanceChoice() });
    },
  },
  {
    method: "PUT",
    path: "/api/appearance",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      json(res, 200, await writeAppearanceChoice(body.choice));
    },
  },
  {
    method: "",
    path: "/api/appearance",
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
];
