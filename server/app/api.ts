import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../modules/http/index.ts";
import { json } from "../modules/transport/index.ts";
import { localOrigin } from "../middlewares/local-origin.ts";
import { handleIntegrationsActions } from "../routes/api/integrations/[...action].ts";
import { handleDirectories } from "../routes/api/directories.ts";
import { handleHealth } from "../routes/api/health.ts";
import { handleAppOpen } from "../routes/api/app/open.ts";
import { handleAppHide } from "../routes/api/app/hide.ts";
import { handleAppRestart } from "../routes/api/app/restart.ts";
import { handleAppQuit } from "../routes/api/app/quit.ts";
import { handleLauncherSettings } from "../routes/api/launcher/settings.ts";
import { handleLauncherSearch } from "../routes/api/launcher/search.ts";
import { handleLauncherLaunch } from "../routes/api/launcher/launch.ts";
import { handleLauncherIcon } from "../routes/api/launcher/icon.ts";
import { handleEvents } from "../routes/api/events.ts";
import { handleStatus } from "../routes/api/status.ts";
import { handleProviders } from "../routes/api/providers.ts";
import { handleProvidersActive } from "../routes/api/providers/active.ts";
import { handleAgent } from "../routes/api/agent.ts";
import { handleInspect } from "../routes/api/inspect.ts";
import { handlePickFolder } from "../routes/api/pick-folder.ts";
import { handlePreviewIcon } from "../routes/api/preview-icon.ts";
import { handleProjectsIndex } from "../routes/api/projects/index.ts";
import { handleProjectWorkspace } from "../routes/api/projects/[id]/workspace.ts";
import { handleProjectTerminals } from "../routes/api/projects/[id]/terminals.ts";
import { handleProjectActions } from "../routes/api/projects/[id]/index.ts";
import { handleIdeKeybindings } from "../routes/api/ide/keybindings.ts";
import { handleEditorSettings } from "../routes/api/ide/editor.ts";
const routes = [
  handleEditorSettings,
  handleIdeKeybindings,
  handleIntegrationsActions,
  handleDirectories,
  handleHealth,
  handleAppOpen,
  handleAppHide,
  handleAppRestart,
  handleAppQuit,
  handleLauncherSettings,
  handleLauncherSearch,
  handleLauncherLaunch,
  handleLauncherIcon,
  handleEvents,
  handleStatus,
  handleProviders,
  handleProvidersActive,
  handleAgent,
  handleInspect,
  handlePickFolder,
  handlePreviewIcon,
  handleProjectsIndex,
  handleProjectWorkspace,
  handleProjectTerminals,
  handleProjectActions,
];
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://" + (req.headers.host ?? "localhost"));
  if (!url.pathname.startsWith("/api")) return false;
  const context = { req, res, url, path: url.pathname, method: req.method ?? "GET" };
  try {
    if (!localOrigin(context)) return true;
    for (const route of routes) if (await route(context)) return true;
    json(res, 404, { error: "Не найден" });
  } catch (error) {
    json(res, error instanceof HttpError ? error.status : 400, {
      error: error instanceof Error ? error.message : "Ошибка",
    });
  }
  return true;
}
