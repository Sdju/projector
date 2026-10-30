import { createServer } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  claimIdeCommand,
  completeIdeCommand,
  ensureIdeMcpToken,
  ideMcpTokenFile,
  ideMcpTokenMatches,
  requestIdeCommand,
} from "../server/modules/ide/index.ts";
import {
  ideMcpServer,
  claudeIdeMcpServer,
  acpIdeMcpServer,
} from "../server/modules/agents/ide-mcp/index.ts";
import { sessionMcpServers } from "../server/modules/agents/acp/acp-backend.ts";

const entry = fileURLToPath(new URL("../server/modules/agents/ide-mcp/server.ts", import.meta.url));
let previous;
let directory;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-ide-mcp-"));
  directory = process.env.XDG_DATA_HOME;
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

describe("IDE MCP bridge", () => {
  it("keeps one key in the data directory and compares it in constant time", async () => {
    const token = await ensureIdeMcpToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(ideMcpTokenFile(), "utf8")).trim()).toBe(token);
    expect((await stat(ideMcpTokenFile())).mode & 0o777).toBe(0o600);
    expect(await ideMcpTokenMatches(token)).toBe(true);
    expect(await ideMcpTokenMatches("wrong")).toBe(false);
    expect(await ideMcpTokenMatches(null)).toBe(false);
  });

  it("times out when no page answers, and ignores unknown claims", async () => {
    expect(claimIdeCommand("missing", "page")).toBe(false);
    expect(completeIdeCommand("missing", "page", { output: 1 })).toBe(false);
    await expect(
      requestIdeCommand("project", "session", { operation: "list" }, 20),
    ).rejects.toThrow("не ответил");
  });

  it("builds the same server for Claude Code and ACP", () => {
    const server = ideMcpServer("project-1");
    expect(server.name).toBe("projector-ide");
    expect(server.args).toEqual([entry]);
    expect(server.env.PROJECTOR_PROJECT_ID).toBe("project-1");
    expect(server.env.PROJECTOR_MCP_TOKEN_FILE).toContain("ide-mcp.token");
    expect(claudeIdeMcpServer("project-1")).toMatchObject({
      type: "stdio",
      command: server.command,
      args: server.args,
      env: server.env,
    });
    expect(acpIdeMcpServer("project-1")).toMatchObject({
      name: server.name,
      command: server.command,
      args: server.args,
      env: [
        { name: "PROJECTOR_MCP_URL", value: server.env.PROJECTOR_MCP_URL },
        { name: "PROJECTOR_MCP_TOKEN_FILE", value: server.env.PROJECTOR_MCP_TOKEN_FILE },
        { name: "PROJECTOR_PROJECT_ID", value: "project-1" },
      ],
    });
  });

  it("keeps a project's own projector-ide when the built-in one is off", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "projector-ide-project-"));
    await writeFile(
      join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { "projector-ide": { command: "own-server" } } }),
    );
    const kept = await sessionMcpServers(cwd, {}, []);
    expect(kept.map((server) => server.name)).toEqual(["projector-ide"]);
    expect(kept[0].command).toBe("own-server");

    const replaced = await sessionMcpServers(cwd, {}, [acpIdeMcpServer("project-1")]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].command).toBe(process.execPath);
  });
});

describe("IDE MCP server", () => {
  it("offers three tools and refuses an execution that was not described", async () => {
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "secret\n");
    const calls = [];
    const bridge = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ output: { ok: true } }));
    });
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const port = bridge.address().port;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: {
        ...process.env,
        PROJECTOR_MCP_URL: `http://127.0.0.1:${port}`,
        PROJECTOR_MCP_TOKEN_FILE: tokenFile,
        PROJECTOR_PROJECT_ID: "project-1",
      },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "describe_command",
        "execute_command",
        "list_commands",
      ]);

      const refused = await client.callTool({
        name: "execute_command",
        arguments: { command: "ide.fileTree.file.rename", scope: "tree" },
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("describe_command");

      await client.callTool({ name: "list_commands", arguments: {} });
      await client.callTool({
        name: "describe_command",
        arguments: { command: "ide.fileTree.file.rename", scope: "tree" },
      });
      const executed = await client.callTool({
        name: "execute_command",
        arguments: {
          command: "ide.fileTree.file.rename",
          scope: "tree",
          args: { path: "old.md", name: "new.md" },
        },
      });
      expect(executed.isError).toBeUndefined();
      expect(calls).toHaveLength(3);
      expect(calls[0]).toMatchObject({
        url: "/api/ide/command-request",
        auth: "Bearer secret",
        body: { projectId: "project-1", request: { operation: "list" } },
      });
      expect(calls[0].body.session).toEqual(expect.any(String));
      expect(calls[2].body.session).toBe(calls[0].body.session);
      expect(calls[2].body.request).toMatchObject({
        operation: "execute",
        args: { path: "old.md", name: "new.md" },
      });
    } finally {
      await client.close();
      bridge.close();
    }
  });
});
