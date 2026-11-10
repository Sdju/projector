import {
  appearanceOptions,
  type AppearanceChoice,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  themeStyleProperties,
  type AvailableTheme,
} from "@ai-projector/core/modules/plugins/index.ts";
import { readAppearanceChoice, writeAppearanceChoice } from "../../modules/appearance/index.ts";
import { discoverPlugins } from "../../modules/plugins/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";

/**
 * A blocking classic script in <head>: it applies the saved scheme before the app and styles paint.
 * The response is built per request, so changing the theme needs neither a rebuild nor a page reload.
 */
function bootstrapScript(choice: AppearanceChoice, theme?: AvailableTheme): string {
  if (!theme) {
    const scheme = ["dark", "light", "contrast", "auto"].includes(choice) ? choice : "dark";
    return `(() => {
  const choice = ${JSON.stringify(scheme)};
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
  const properties = themeStyleProperties(theme.tokens);
  return `(() => {
  const choice = ${JSON.stringify(choice)};
  const root = document.documentElement;
  const scheme = choice;
  const mode = ${JSON.stringify(theme.mode)};
  root.dataset.appearance = choice;
  root.dataset.theme = scheme;
  const properties = ${JSON.stringify(properties)};
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", properties["--bg"] ?? "");
})();
`;
}

async function appearanceResponse() {
  const [choice, catalog] = await Promise.all([readAppearanceChoice(), discoverPlugins()]);
  const builtinThemes = appearanceOptions
    .filter((option) => option.id !== "auto")
    .map((option) => ({ ...option }));
  return { choice, themes: [...builtinThemes, ...catalog.availableThemes] };
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
      const choice = await readAppearanceChoice();
      const theme = (await discoverPlugins()).availableThemes.find((item) => item.id === choice);
      res.end(bootstrapScript(choice, theme));
    },
  },
  {
    method: "GET",
    path: "/api/appearance",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Настройки доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await appearanceResponse());
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
      const catalog = await discoverPlugins();
      json(
        res,
        200,
        await writeAppearanceChoice(
          body.choice,
          catalog.availableThemes.map((theme) => theme.id),
        ),
      );
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
