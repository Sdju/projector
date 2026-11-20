import { shallowRef, type Component } from "vue";
import { deviconIcons, lucideIcons, simpleIcons } from "./sets.ts";

/**
 * An icon the interface can ask for by name. A name without a set is Lucide
 * (`chevron-right`); another set is written with its prefix (`simple-icons:github`).
 * Names are strings, so data, plugins and settings can carry them without importing Vue
 * components, and a name may be replaced at runtime with `registerIcon`.
 */
export type IconName = string;

/** Shown instead of an unknown icon: a visible question mark beats a silent gap. */
export const ICON_FALLBACK: IconName = "lucide:circle-question-mark";

/** Short names the chat widgets and older code used for a Lucide icon. */
const aliases = new Map<string, IconName>([["alert", "lucide:circle-alert"]]);

const builtin = new Map<string, Component>();
for (const [prefix, icons] of [
  ["lucide", lucideIcons],
  ["simple-icons", simpleIcons],
  ["devicon", deviconIcons],
] as const)
  for (const [name, icon] of Object.entries(icons)) builtin.set(`${prefix}:${name}`, icon);

/** Names added or replaced at runtime; they win over the bundled set. */
const overrides = new Map<string, Component>();
const missing = new Set<string>();
/** Bumped on every registry change, so mounted icons re-render with the new component. */
const revision = shallowRef(0);

/** Data can carry a stale component or a number from an older payload; a name must be text. */
function canonical(name: IconName): string {
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  const alias = aliases.get(trimmed);
  if (alias) return alias;
  return trimmed.includes(":") ? trimmed : `lucide:${trimmed}`;
}

function lookup(id: string): Component | undefined {
  return overrides.get(id) ?? builtin.get(id);
}

/** Registers an icon, replacing the bundled one under the same name. */
export function registerIcon(name: IconName, icon: Component): void {
  registerIcons({ [name]: icon });
}

/** Registers several icons at once; the registry updates mounted icons in one pass. */
export function registerIcons(icons: Record<IconName, Component>): void {
  let changed = false;
  for (const [name, icon] of Object.entries(icons)) {
    const id = canonical(name);
    if (!id) continue;
    overrides.set(id, icon);
    missing.delete(id);
    changed = true;
  }
  if (changed) revision.value++;
}

/** Drops a runtime icon, so the bundled one (or the fallback) shows again. */
export function unregisterIcon(name: IconName): void {
  if (!overrides.delete(canonical(name))) return;
  revision.value++;
}

/** Whether the name is known, without logging a miss. */
export function hasIcon(name: IconName): boolean {
  void revision.value;
  return lookup(canonical(name)) !== undefined;
}

/** Every known name, including the runtime ones; sorted for lists and settings. */
export function iconNames(): IconName[] {
  void revision.value;
  return [...new Set([...builtin.keys(), ...overrides.keys()])].sort();
}

/** The component behind a name; an unknown name logs once and shows the fallback. */
export function resolveIcon(name: IconName): Component {
  void revision.value;
  const id = canonical(name);
  const icon = id ? lookup(id) : undefined;
  if (icon) return icon;
  const key = id || `invalid:${typeof name}`;
  if (!missing.has(key)) {
    missing.add(key);
    console.warn(
      `Иконка «${String(name)}» не найдена — показана запасная. Добавьте её в набор или зарегистрируйте через registerIcon().`,
    );
  }
  return lookup(ICON_FALLBACK) ?? lucideIcons["circle-question-mark"]!;
}
