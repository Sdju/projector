import {
  antigravitySkillState,
  cachedAntigravityUsage,
  installAntigravitySkill,
  refreshAntigravityUsage,
  removeAntigravitySkill,
} from "../../modules/agents/antigravity/index.ts";
import { recordAgentLimits } from "../../modules/usage-analytics/index.ts";
import { json, type RouteDefinition } from "../../modules/transport/index.ts";

/**
 * Explicit user-driven Antigravity endpoints:
 * - `/api/antigravity/skill` manages `~/.gemini/config/skills/projector/SKILL.md`.
 * - `/api/antigravity/usage` reads only the cached snapshot (never spawns `agy`).
 * - `POST /api/antigravity/usage/refresh` runs the official `agy -p "/usage"` once on button click.
 */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/antigravity/usage",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, cachedAntigravityUsage());
    },
  },
  {
    method: "POST",
    path: "/api/antigravity/usage/refresh",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      const value = await refreshAntigravityUsage();
      if (value.status === "ready") recordAgentLimits("antigravity", value);
      json(res, 200, value);
    },
  },
  {
    method: "GET",
    path: "/api/antigravity/skill",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await antigravitySkillState());
    },
  },
  {
    method: "PUT",
    path: "/api/antigravity/skill",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await installAntigravitySkill());
    },
  },
  {
    method: "DELETE",
    path: "/api/antigravity/skill",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await removeAntigravitySkill());
    },
  },
];
