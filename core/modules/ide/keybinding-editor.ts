import type { Keybinding, KeyStroke } from "./commands.ts";

// Replacing one row must preserve the command's other bindings and all other commands.
export function editKeybinding(
  defaults: Keybinding[],
  overrides: Keybinding[],
  command: string,
  index: number,
  key: string | null,
): Keybinding[] {
  const custom = overrides.filter((rule) => rule.command === command);
  const rules = structuredClone(
    custom.length ? custom : defaults.filter((rule) => rule.command === command),
  );
  const previous = rules[index];
  const replacement = {
    ...previous,
    command,
    key: key ?? previous?.key ?? "Unassigned",
    disabled: key === null,
  };
  if (previous) rules[index] = replacement;
  else rules.push(replacement);
  return [...overrides.filter((rule) => rule.command !== command), ...rules];
}
export function recordedKey(event: KeyStroke): string | undefined {
  if (
    event.isComposing ||
    event.repeat ||
    ["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified", "+"].includes(event.key)
  )
    return;
  return [
    event.ctrlKey && "Ctrl",
    event.metaKey && "Meta",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key,
  ]
    .filter(Boolean)
    .join("+");
}
