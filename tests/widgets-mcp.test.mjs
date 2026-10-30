import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vite-plus/test";
import {
  acpWidgetsMcpServer,
  claudeWidgetsMcpServer,
  widgetsMcpServer,
} from "../server/modules/agents/widgets-mcp/index.ts";

const entry = fileURLToPath(new URL("../server/app/widgets-mcp.ts", import.meta.url));

describe("widgets MCP", () => {
  it("builds the same server for Claude Code and ACP", () => {
    const server = widgetsMcpServer();
    expect(server.name).toBe("projector-widgets");
    expect(server.args).toEqual([entry]);
    expect(claudeWidgetsMcpServer()).toMatchObject({
      type: "stdio",
      command: server.command,
      args: server.args,
      env: {},
      alwaysLoad: true,
    });
    expect(acpWidgetsMcpServer()).toEqual({
      name: server.name,
      command: server.command,
      args: server.args,
      env: [],
    });
  });

  it("describes special widgets and refuses ordinary ones", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: process.env,
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["describe_widget"]);

      const special = await client.callTool({
        name: "describe_widget",
        arguments: { name: "GitInfo" },
      });
      expect(special.isError).not.toBe(true);
      expect(special.content[0].text).toContain("branch: string");
      expect(special.content[0].text).toContain("<GitInfo");

      const ordinary = await client.callTool({
        name: "describe_widget",
        arguments: { name: "Card" },
      });
      expect(ordinary.isError).toBe(true);
      expect(ordinary.content[0].text).toContain("не специальный");
    } finally {
      await client.close();
    }
  });
});
