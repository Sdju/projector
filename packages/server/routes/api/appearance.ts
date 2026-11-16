import {
  appearanceOptions,
  type AppearanceChoice,
  type AppearanceFonts,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  themeStyleProperties,
  type AvailableTheme,
} from "@ai-projector/core/modules/plugins/index.ts";
import {
  discoverUserThemes,
  readAppearance,
  writeAppearance,
} from "../../modules/appearance/index.ts";
import { discoverPlugins } from "../../modules/plugins/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";

/** Mirrors --bg-2 in styles.css; the bootstrap runs before the stylesheet is available. */
const bootstrapThemeColors = {
  dark: "#171716",
  light: "#efeee8",
  contrast: "#080808",
} as const;

/**
 * A blocking classic script in <head>: it applies the saved scheme and chat font before paint.
 * The response is built per request, so changing appearance needs neither a rebuild nor a reload.
 */
function bootstrapScript(
  choice: AppearanceChoice,
  fonts: AppearanceFonts,
  theme?: AvailableTheme,
): string {
  const chatFs = `${fonts.chat}px`;
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
  root.style.setProperty("--chat-fs", ${JSON.stringify(chatFs)});
  const themeColors = ${JSON.stringify(bootstrapThemeColors)};
  const light = scheme === "light";
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[scheme] ?? themeColors.dark);
  document.getElementById("app-favicon")?.setAttribute("href", light ? "/favicon-light.svg" : "/favicon.svg");
  document.getElementById("app-touch-icon")?.setAttribute("href", light ? "/icons/apple-touch-icon-light.png" : "/icons/apple-touch-icon.png");
  document.getElementById("app-manifest")?.setAttribute("href", light ? "/manifest-light.webmanifest" : "/manifest.webmanifest");
  document.getElementById("app-status-bar")?.setAttribute("content", light ? "default" : "black");
})();
`;
  }
  const properties = themeStyleProperties(theme.tokens);
  return `(() => {
  const choice = ${JSON.stringify(choice)};
  const root = document.documentElement;
  const scheme = choice;
  const mode = ${JSON.stringify(theme.mode)};
  const light = ${JSON.stringify(theme.mode === "light")};
  root.dataset.appearance = choice;
  root.dataset.theme = scheme;
  root.style.setProperty("--chat-fs", ${JSON.stringify(chatFs)});
  const properties = ${JSON.stringify(properties)};
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", properties["--bg"] ?? "");
  document.getElementById("app-favicon")?.setAttribute("href", light ? "/favicon-light.svg" : "/favicon.svg");
  document.getElementById("app-touch-icon")?.setAttribute("href", light ? "/icons/apple-touch-icon-light.png" : "/icons/apple-touch-icon.png");
  document.getElementById("app-manifest")?.setAttribute("href", light ? "/manifest-light.webmanifest" : "/manifest.webmanifest");
  document.getElementById("app-status-bar")?.setAttribute("content", light ? "default" : "black");
})();
`;
}

async function appearanceResponse() {
  const [settings, catalog, userThemes] = await Promise.all([
    readAppearance(),
    discoverPlugins(),
    discoverUserThemes(),
  ]);
  const builtinThemes = appearanceOptions
    .filter((option) => option.id !== "auto")
    .map((option) => ({ ...option }));
  return {
    choice: settings.choice,
    fonts: settings.fonts,
    themes: [...builtinThemes, ...catalog.availableThemes, ...userThemes],
  };
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
      const [settings, catalog, userThemes] = await Promise.all([
        readAppearance(),
        discoverPlugins(),
        discoverUserThemes(),
      ]);
      const theme = [...catalog.availableThemes, ...userThemes].find(
        (item) => item.id === settings.choice,
      );
      res.end(bootstrapScript(settings.choice, settings.fonts, theme));
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
      if (body.choice === undefined && body.fonts === undefined)
        throw new HttpError(400, "Укажите choice или fonts");
      const [catalog, userThemes] = await Promise.all([discoverPlugins(), discoverUserThemes()]);
      const settings = await writeAppearance(
        { choice: body.choice, fonts: body.fonts },
        [...catalog.availableThemes, ...userThemes].map((theme) => theme.id),
      );
      json(res, 200, { choice: settings.choice, fonts: settings.fonts });
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
