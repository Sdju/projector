import { accessAllowed } from "../../modules/access/index.ts";
import { projectRoleState, setProjectRoleTrust } from "../../modules/agent-roles/index.ts";
import { projectPresetState, setProjectPresetTrust } from "../../modules/agent-presets/index.ts";
import { decideDevcontainer, devcontainerState } from "../../modules/devcontainer/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { discoverPlugins, trustPlugin } from "../../modules/plugins/index.ts";
import {
  projectAppearanceState,
  setProjectAppearanceTrust,
} from "../../modules/project-appearance/index.ts";
import { auditAllProjectTrust, auditProjectTrust } from "../../modules/project-trust/index.ts";
import { loadProjects } from "../../modules/projects/index.ts";
import { projectWidgetState, setProjectWidgetTrust } from "../../modules/project-widgets/index.ts";
import { readTrustNotices } from "../../modules/trust-notices/index.ts";
import { asString, json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";
import type { TrustNotice } from "@ai-projector/core/modules/trust-notices/index.ts";

const pageOnly = (req: Parameters<typeof accessAllowed>[0], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Уведомления доверия доступны только со страницы Projector");
};

/** Trusting a file that changed after its notice would trust unseen content. */
function unchanged(notice: TrustNotice, hash: string | undefined): void {
  if (notice.hash && notice.hash !== hash)
    throw new HttpError(
      409,
      "Файл изменился после уведомления. Откройте настройки и проверьте текущее содержимое.",
    );
}

async function trustProject(notice: TrustNotice): Promise<void> {
  const projectId = notice.projectId;
  if (!projectId) throw new HttpError(404, "Проект уведомления не найден");
  if (notice.kind === "appearance") {
    unchanged(notice, (await projectAppearanceState(projectId)).hash);
    await setProjectAppearanceTrust(projectId, true);
  } else if (notice.kind === "roles") {
    unchanged(notice, (await projectRoleState(projectId)).hash);
    await setProjectRoleTrust(projectId, true);
  } else if (notice.kind === "widgets") {
    unchanged(notice, (await projectWidgetState(projectId)).hash);
    await setProjectWidgetTrust(projectId, true);
  } else if (notice.kind === "presets") {
    unchanged(notice, (await projectPresetState(projectId)).hash);
    await setProjectPresetTrust(projectId, true);
  } else if (notice.kind === "devcontainer") {
    const project = (await loadProjects()).find((item) => item.id === projectId);
    if (!project) throw new HttpError(404, "Проект уведомления не найден");
    const state = devcontainerState(project);
    if (!state.found || !state.hash) throw new HttpError(404, "Dev Container не найден");
    unchanged(notice, state.hash);
    await decideDevcontainer(project, "trusted", state.hash);
  }
  await auditProjectTrust(projectId);
}

async function trustFromNotice(notice: TrustNotice): Promise<void> {
  if (notice.scope === "project") return trustProject(notice);
  if (!notice.plugin) throw new HttpError(404, "Плагин уведомления не найден");
  const plugin = (await discoverPlugins()).plugins.find((item) => item.id === notice.plugin);
  if (!plugin) throw new HttpError(404, "Плагин уведомления не найден");
  unchanged(notice, plugin.hash);
  await trustPlugin(notice.plugin);
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/trust-notices",
    handler: async ({ req, res }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      // A file may have changed while the page was closed or outside the watched tree. Discovery is
      // also the only place that knows whether an installed plugin still matches its trust hash.
      await discoverPlugins();
      await auditAllProjectTrust();
      json(res, 200, { notices: await readTrustNotices() });
    },
  },
  {
    method: "POST",
    path: "/api/trust-notices",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const id = asString(body.id).trim();
      if (!id) throw new HttpError(400, "Укажите id уведомления");
      const notice = (await readTrustNotices()).find((item) => item.id === id);
      if (!notice) throw new HttpError(404, "Уведомление не найдено");
      await trustFromNotice(notice);
      json(res, 200, { notices: await readTrustNotices() });
    },
  },
  {
    method: "",
    path: "/api/trust-notices",
    handler: ({ req, res }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустимы GET и POST" });
    },
  },
];
