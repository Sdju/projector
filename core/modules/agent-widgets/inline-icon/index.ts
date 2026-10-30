import { defineWidget } from "../../widget-catalog/index.ts";

/**
 * Lucide names kept deliberately small: every name is bundled into the chat, and an unknown icon
 * must not cost an arbitrary network request at render time.
 */
export const INLINE_ICON_NAMES = [
  "alert",
  "arrow-right",
  "check",
  "chevron-right",
  "circle-check",
  "clock",
  "cloud",
  "code",
  "database",
  "external-link",
  "file",
  "folder",
  "git-branch",
  "git-commit",
  "info",
  "lock",
  "package",
  "play",
  "search",
  "settings",
  "sparkles",
  "terminal",
  "test-tube",
  "x",
] as const;

export const inlineIconWidget = defineWidget({
  name: "InlineIcon",
  group: "data",
  summary: "небольшая иконка внутри строки или рядом с подписью",
  props: {
    name: {
      type: "string",
      description: `одно из имён: ${INLINE_ICON_NAMES.join(", ")}`,
      required: true,
    },
    label: { type: "string", description: "доступное название; без него иконка декоративная" },
  },
  example: '<InlineIcon name="git-branch" label="Ветка" />',
});
