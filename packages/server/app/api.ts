import { handleHubRelay } from "../modules/hub/index.ts";
import { routes as hubRoutes } from "../routes/api/hub.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../modules/http/index.ts";
import { createRouteDispatcher, json } from "../modules/transport/index.ts";
import { handlePluginRoute } from "../modules/plugin-routes/index.ts";
import { localOrigin } from "../middlewares/local-origin.ts";
import { routes as integrationsActionsRoutes } from "../routes/api/integrations/[...action].ts";
import { routes as githubBrowseRoutes } from "../routes/api/integrations/github-browse.ts";
import { routes as directoriesRoutes } from "../routes/api/directories.ts";
import { routes as healthRoutes } from "../routes/api/health.ts";
import { routes as appOpenRoutes } from "../routes/api/app/open.ts";
import { routes as appHideRoutes } from "../routes/api/app/hide.ts";
import { routes as appRestartRoutes } from "../routes/api/app/restart.ts";
import { routes as appModeRoutes } from "../routes/api/app/mode.ts";
import { routes as appQuitRoutes } from "../routes/api/app/quit.ts";
import { routes as appNetworkRoutes } from "../routes/api/app/network.ts";
import { routes as appUpdateRoutes } from "../routes/api/app/update.ts";
import { routes as launcherSettingsRoutes } from "../routes/api/launcher/settings.ts";
import { routes as launcherSearchRoutes } from "../routes/api/launcher/search.ts";
import { routes as launcherLaunchRoutes } from "../routes/api/launcher/launch.ts";
import { routes as launcherIconRoutes } from "../routes/api/launcher/icon.ts";
import { routes as eventsRoutes } from "../routes/api/events.ts";
import { routes as statusRoutes } from "../routes/api/status.ts";
import { routes as providersRoutes } from "../routes/api/providers.ts";
import { routes as providersActiveRoutes } from "../routes/api/providers/active.ts";
import { routes as providersBalanceRoutes } from "../routes/api/providers/balance.ts";
import { routes as providersModelsRoutes } from "../routes/api/providers/models.ts";
import { routes as providersUsageRoutes } from "../routes/api/providers/usage.ts";
import { routes as agentRoutes } from "../routes/api/agent.ts";
import { routes as agentLaunchRoutes } from "../routes/api/agent-launch.ts";
import { routes as agentUsageRoutes } from "../routes/api/agent-usage.ts";
import { routes as agentFormRepairRoutes } from "../routes/api/agent-form-repair.ts";
import { routes as agentAnswerRepairRoutes } from "../routes/api/agent-answer-repair.ts";
import { routes as agentSecretShowRoutes } from "../routes/api/agent-secret-show.ts";
import { routes as agentLensRoutes } from "../routes/api/agent-lens.ts";
import { routes as agentSideRoutes } from "../routes/api/agent-side.ts";
import { routes as agentSkillsRoutes } from "../routes/api/agent-skills.ts";
import { routes as agentFeaturesRoutes } from "../routes/api/agent-features.ts";
import { routes as agentPresetsRoutes } from "../routes/api/agent-presets.ts";
import { routes as agentJudgeRoutes } from "../routes/api/agent-judge.ts";
import { routes as agentRolesRoutes } from "../routes/api/agent-roles.ts";
import { routes as agentListenerRoutes } from "../routes/api/agent-listener.ts";
import { routes as agentProjectRolesRoutes } from "../routes/api/agent-project-roles.ts";
import { routes as agentProjectWidgetsRoutes } from "../routes/api/agent-project-widgets.ts";
import { routes as agentWebRoutes } from "../routes/api/agent-web.ts";
import { routes as agentMcpRoutes } from "../routes/api/agent-mcp.ts";
import { routes as agentHooksRoutes } from "../routes/api/agent-hooks.ts";
import { routes as agentMemoryRoutes } from "../routes/api/agent-memory.ts";
import { routes as agentJobsRoutes } from "../routes/api/agent-jobs.ts";
import { routes as agentChatsRoutes } from "../routes/api/agent-chats.ts";
import { routes as agentWorktreesRoutes } from "../routes/api/agent-worktrees.ts";
import { routes as inspectRoutes } from "../routes/api/inspect.ts";
import { routes as pickFolderRoutes } from "../routes/api/pick-folder.ts";
import { routes as previewIconRoutes } from "../routes/api/preview-icon.ts";
import { routes as projectsIndexRoutes } from "../routes/api/projects/index.ts";
import { routes as projectWorkspaceRoutes } from "../routes/api/projects/[id]/workspace.ts";
import { routes as projectWorkspaceReadRoutes } from "../routes/api/projects/[id]/workspace-read.ts";
import { routes as projectSiteRoutes } from "../routes/api/projects/[id]/site.ts";
import { routes as projectTerminalsRoutes } from "../routes/api/projects/[id]/terminals.ts";
import { routes as projectActionsRoutes } from "../routes/api/projects/[id]/index.ts";
import { routes as projectAppearanceRoutes } from "../routes/api/projects/[id]/appearance.ts";
import { routes as ideKeybindingsRoutes } from "../routes/api/ide/keybindings.ts";
import { routes as ideCommandsRoutes } from "../routes/api/ide/commands.ts";
import { routes as editorSettingsRoutes } from "../routes/api/ide/editor.ts";
import { routes as appearanceRoutes } from "../routes/api/appearance.ts";
import { routes as hiddenActionsRoutes } from "../routes/api/ide/hidden-actions.ts";
import { routes as trustNoticesRoutes } from "../routes/api/trust-notices.ts";
import { routes as pluginsRoutes } from "../routes/api/plugins.ts";
import { routes as filesExcludeRoutes } from "../routes/api/ide/files-exclude.ts";
import { routes as dockerRoutes } from "../routes/api/docker.ts";
import { routes as codexRoutes } from "../routes/api/codex.ts";
import { routes as openCodeRoutes } from "../routes/api/opencode.ts";
import { routes as kimiRoutes } from "../routes/api/kimi.ts";
import { routes as analyticsRoutes } from "../routes/api/analytics.ts";
import { routes as mediaRoutes } from "../routes/api/media.ts";
import "./media-adapters.ts";
import "./provider-usage.ts";
import { routes as openAiRoutes } from "../routes/api/openai.ts";
import { routes as browserRoutes } from "../routes/api/browser.ts";
import { ensureAgentsReady } from "./agents.ts";
const dispatch = createRouteDispatcher([
  ...hubRoutes,
  ...openAiRoutes,
  ...mediaRoutes,
  ...browserRoutes,
  ...analyticsRoutes,
  ...kimiRoutes,
  ...openCodeRoutes,
  ...codexRoutes,
  ...dockerRoutes,
  ...filesExcludeRoutes,
  ...editorSettingsRoutes,
  ...appearanceRoutes,
  ...hiddenActionsRoutes,
  ...pluginsRoutes,
  ...trustNoticesRoutes,
  ...ideKeybindingsRoutes,
  ...ideCommandsRoutes,
  ...githubBrowseRoutes,
  ...integrationsActionsRoutes,
  ...directoriesRoutes,
  ...healthRoutes,
  ...appOpenRoutes,
  ...appHideRoutes,
  ...appRestartRoutes,
  ...appQuitRoutes,
  ...appModeRoutes,
  ...appNetworkRoutes,
  ...appUpdateRoutes,
  ...launcherSettingsRoutes,
  ...launcherSearchRoutes,
  ...launcherLaunchRoutes,
  ...launcherIconRoutes,
  ...eventsRoutes,
  ...statusRoutes,
  ...providersRoutes,
  ...providersActiveRoutes,
  ...providersBalanceRoutes,
  ...providersModelsRoutes,
  ...providersUsageRoutes,
  ...agentMemoryRoutes,
  ...agentMcpRoutes,
  ...agentHooksRoutes,
  ...agentWebRoutes,
  ...agentSkillsRoutes,
  ...agentFeaturesRoutes,
  ...agentPresetsRoutes,
  ...agentJudgeRoutes,
  ...agentRolesRoutes,
  ...agentListenerRoutes,
  ...agentProjectRolesRoutes,
  ...agentProjectWidgetsRoutes,
  ...agentRoutes,
  ...agentLaunchRoutes,
  ...agentUsageRoutes,
  ...agentFormRepairRoutes,
  ...agentAnswerRepairRoutes,
  ...agentSecretShowRoutes,
  ...agentLensRoutes,
  ...agentSideRoutes,
  ...agentJobsRoutes,
  ...agentChatsRoutes,
  ...agentWorktreesRoutes,
  ...inspectRoutes,
  ...pickFolderRoutes,
  ...previewIconRoutes,
  ...projectsIndexRoutes,
  ...projectSiteRoutes,
  ...projectWorkspaceRoutes,
  ...projectWorkspaceReadRoutes,
  ...projectTerminalsRoutes,
  ...projectAppearanceRoutes,
  ...projectActionsRoutes,
]);
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // Plugin agents are discovered asynchronously; the first request sees the whole catalog.
  await ensureAgentsReady();
  let url: URL;
  try {
    // Routing does not depend on the untrusted Host header.
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    json(res, 400, { error: "Некорректный адрес запроса" });
    return true;
  }
  if (!url.pathname.startsWith("/api")) return false;
  const method = req.method ?? "GET";
  const context = { req, res, url, path: url.pathname, method };
  try {
    if (!localOrigin(context)) return true;
    if (handleHubRelay(req, res, url.pathname)) return true;
    if (await dispatch(context)) return true;
    if (await handlePluginRoute(context)) return true;
    json(res, 404, { error: "Не найден" });
  } catch (error) {
    json(res, error instanceof HttpError ? error.status : 400, {
      error: error instanceof Error ? error.message : "Ошибка",
    });
  }
  return true;
}
