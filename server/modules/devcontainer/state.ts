import { realpathSync } from "node:fs";
import { classifyDevcontainer } from "../../../core/modules/devcontainer/index.ts";
import type {
  DevcontainerDecision,
  DevcontainerState,
} from "../../../core/modules/devcontainer/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";
import { HttpError } from "../http/index.ts";
import { findDevcontainer } from "./discovery.ts";
import { saveTrust, trustEntry } from "./trust.ts";

function resolved(project: Project) {
  const root = realpathSync(project.path);
  const found = findDevcontainer(root);
  const entry = trustEntry(root);
  return { root, found, entry };
}
/** Trust applies only while the decision was made for the config as it is now. */
const current = (entry: { hash: string } | undefined, hash: string | undefined) =>
  !!entry && entry.hash === hash;

export function devcontainerState(project: Project): DevcontainerState {
  const { found, entry } = resolved(project);
  if (!found)
    return {
      found: false,
      findings: [],
      decision: null,
      stale: false,
      needsDecision: false,
      active: false,
    };
  const findings = classifyDevcontainer(found.config);
  const valid = current(entry, found.hash);
  const decision = valid ? entry!.decision : null;
  return {
    found: true,
    configPath: found.relativePath,
    name: typeof found.config.name === "string" ? found.config.name : undefined,
    hash: found.hash,
    findings,
    decision,
    stale: !!entry && !valid,
    needsDecision: findings.length > 0 && !decision,
    active: decision === "trusted",
  };
}

/** `hash` is what the user saw; a config edited since then cannot be trusted by accident. */
export async function decideDevcontainer(
  project: Project,
  decision: DevcontainerDecision | "forget",
  hash: unknown,
): Promise<DevcontainerState> {
  const { root, found } = resolved(project);
  if (!found) throw new HttpError(404, "В проекте нет devcontainer.json");
  if (decision === "forget") await saveTrust(root, null);
  else {
    if (hash !== found.hash)
      throw new HttpError(409, "Конфигурация изменилась после показа. Проверьте её ещё раз");
    await saveTrust(root, {
      decision,
      configPath: found.relativePath,
      hash: found.hash,
      decidedAt: new Date().toISOString(),
    });
  }
  return devcontainerState(project);
}

/** The config to run with, or undefined when the project must keep the restricted model. */
export function trustedDevcontainer(project: Project) {
  try {
    const { found, entry } = resolved(project);
    return found && entry?.decision === "trusted" && current(entry, found.hash) ? found : undefined;
  } catch {
    return undefined;
  }
}
