import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "1" });
server.registerTool(
  "echo",
  {
    description: "Возвращает текст",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `эхо: ${text}` }] }),
);
server.registerTool(
  "write",
  { description: "Меняет что-то", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text: `записано: ${text}` }] }),
);
await server.connect(new StdioServerTransport());
