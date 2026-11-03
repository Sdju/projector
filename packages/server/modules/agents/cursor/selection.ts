import type { AgentControl, AgentSelection } from "../../agent/index.ts";

/** A stored model id that still carries parameters: `id[k=v,k=v]`. */
const VARIANT = /^([^[\]]+)\[(.+)\]$/;

/**
 * Splits an older combined model id into separate knobs when the agent now offers them that way.
 * A catalog that still lists the combined id is left alone.
 */
export function normalizeCursorSelection(
  selection: AgentSelection,
  controls: AgentControl[],
): AgentSelection {
  const model = selection.model;
  if (!model) return selection;
  const match = VARIANT.exec(model);
  if (!match) return selection;
  const base = match[1]!;
  const catalog = controls.find((control) => control.id === "model");
  if (!catalog?.options.some((option) => option.value === base)) return selection;
  const next: AgentSelection = { ...selection, model: base };
  for (const part of match[2]!.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const id = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (id && value && next[id] === undefined) next[id] = value;
  }
  return next;
}
