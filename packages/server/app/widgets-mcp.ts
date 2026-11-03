// The built-in widget MCP server: one tool over the live catalogue, not one tool per special
// widget. External agents start this process only while the widgets feature is enabled.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { widgetCatalog } from "../modules/agents/projector/index.ts";

registerBuiltinWidgetDefinitions();

const server = new McpServer(
  { name: "projector-widgets", version: "1" },
  {
    instructions:
      "Полные описания виджетов Projector. Для виджета из раздела «Специальные виджеты» вызови describe_widget перед первым использованием; обычные уже описаны в промпте.",
  },
);

server.registerTool(
  "describe_widget",
  {
    description:
      "Полное описание виджета: свойства, ограничения и пример. Для специального виджета вызывай перед первым использованием; для обычного не обязательно — описание уже в промпте.",
    inputSchema: { name: z.string().describe("Имя виджета") },
  },
  async ({ name }) => {
    try {
      return { content: [{ type: "text" as const, text: widgetCatalog.describe(name) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : `Не удалось описать виджет ${name}`,
          },
        ],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
