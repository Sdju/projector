/** Human names of the context categories reported by the agent. */
export const contextCategoryNames: Record<string, string> = {
  "System prompt": "Системный промпт",
  "System tools": "Инструменты",
  "MCP tools": "MCP-инструменты",
  "Custom agents": "Агенты",
  "Memory files": "Файлы памяти",
  Skills: "Навыки",
  Messages: "Сообщения",
};

/**
 * Each kind of content keeps its colour, so a segment of the bar is recognised by it, not by order.
 * Colours are built from theme tokens: no per-category hex that would drift from the scheme.
 */
export const contextCategoryColors: Record<string, string> = {
  "System prompt": "var(--info)",
  "System tools": "color-mix(in srgb, var(--info) 65%, var(--accent))",
  "MCP tools": "color-mix(in srgb, var(--accent) 70%, var(--err))",
  "Custom agents": "color-mix(in srgb, var(--run) 65%, var(--info))",
  "Memory files": "var(--accent)",
  Skills: "color-mix(in srgb, var(--warn) 70%, var(--err))",
  Messages: "var(--run)",
};
