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
      "Полные описания специальных виджетов Projector. Перед первым использованием виджета из раздела «Специальные виджеты» вызови describe_widget с его именем.",
  },
);

server.registerTool(
  "describe_widget",
  {
    description:
      "Полное описание специального виджета: свойства, ограничения и пример. Вызывай перед первым использованием такого виджета. Для обычных виджетов не нужен — их описание уже в промпте.",
    inputSchema: { name: z.string().describe("Имя специального виджета") },
  },
  async ({ name }) => {
    try {
      return { content: [{ type: "text" as const, text: widgetCatalog.describeSpecial(name) }] };
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
