import {
  appearanceOptions,
  builtinAppearance,
  isBuiltinAppearance,
  type AppearanceSettings,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  themeStyleProperties,
  themeEffectStyle,
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

/** Applies the saved scheme and its settings before the stylesheet paints. */
function bootstrapScript(
  { choice, fonts, themeSettings }: AppearanceSettings,
  theme?: AvailableTheme,
): string {
  const preferred = theme || isBuiltinAppearance(choice) ? choice : "dark";
  const builtin = builtinAppearance(preferred);
  const fields = theme?.settings ?? builtin?.settings ?? [];
  const properties = {
    ...(theme && themeStyleProperties(theme.tokens)),
    ...themeEffectStyle(fields, themeSettings[preferred]),
  };
  const colors = Object.fromEntries(
    appearanceOptions.flatMap((option) =>
      "themeColor" in option ? [[option.id, option.themeColor]] : [],
    ),
  );
  return `(() => {
  const choice = ${JSON.stringify(preferred)};
  const root = document.documentElement;
  const scheme = choice === "auto"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : choice;
  const mode = ${preferred === "auto" ? 'scheme === "light" ? "light" : "dark"' : JSON.stringify(theme?.mode ?? builtin?.mode ?? "dark")};
  const light = mode === "light";
  root.dataset.appearance = choice;
  root.dataset.theme = scheme;
  ${fields.length ? 'root.dataset.themeEffects = "";' : ""}
  ${theme ? "root.style.colorScheme = mode;" : ""}
  root.style.setProperty("--chat-fs", ${JSON.stringify(`${fonts.chat}px`)});
  const properties = ${JSON.stringify(properties)};
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
  const themeColors = ${JSON.stringify(colors)};
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ${theme ? JSON.stringify(theme.tokens.bg) : "themeColors[scheme] ?? themeColors.dark"});
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
    .map(({ id, title, description, mode }) => ({
      id,
      title,
      description,
      mode,
      settings: builtinAppearance(id)?.settings,
    }));
  return {
    ...settings,
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
      res.end(bootstrapScript(settings, theme));
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
      if (body.choice === undefined && body.fonts === undefined && body.themeSettings === undefined)
        throw new HttpError(400, "Укажите choice, fonts или themeSettings");
      const [catalog, userThemes] = await Promise.all([discoverPlugins(), discoverUserThemes()]);
      const externalThemes = [...catalog.availableThemes, ...userThemes];
      const settings = await writeAppearance(
        { choice: body.choice, fonts: body.fonts, themeSettings: body.themeSettings },
        externalThemes,
      );
      json(res, 200, settings);
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
