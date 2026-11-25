import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { isPluginPackageName } from "@ai-projector/core/modules/plugins/index.ts";
import { projectPluginsRelativeFile } from "./directory.ts";

export type ProjectPluginIntent = Record<string, boolean>;

/**
 * `.projector/plugins.json` expresses what the repository wants, not what the device allows.
 * The device still needs its own trust and enable decision; a cloned repository cannot turn code
 * on by itself. An absent or broken file simply requests nothing.
 */
export async function readProjectPluginIntent(root: string): Promise<ProjectPluginIntent> {
  let raw: string;
  try {
    const file = await realpath(join(root, projectPluginsRelativeFile));
    if (!file.startsWith(`${root}${sep}`)) return {};
    raw = await readFile(file, "utf8");
  } catch {
    return {};
  }
  if (raw.length > 1_000_000) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  const plugins = (value as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return {};
  const intent: ProjectPluginIntent = {};
  for (const [name, entry] of Object.entries(plugins)) {
    if (!isPluginPackageName(name)) continue;
    if (entry === true) intent[name] = true;
    else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const enabled = (entry as { enabled?: unknown }).enabled;
      if (typeof enabled === "boolean") intent[name] = enabled;
    }
  }
  return intent;
}
