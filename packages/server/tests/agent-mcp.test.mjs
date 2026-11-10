import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { connectMcp, mcpToolName } from "../modules/agents/projector/projector-mcp.ts";
import { mcpServerConfigs } from "../modules/agents/projector/projector-mcp-config.ts";
import { mcpConfigsForNames, processMcpConfig } from "../modules/agent-mcp/index.ts";

const server = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures",
  "mcp-echo-server.mjs",
);
const entry = { command: process.execPath, args: [server] };

let previous;
let project;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = await mkdtemp(join(tmpdir(), "projector-mcp-"));
  project = await mkdtemp(join(tmpdir(), "projector-mcp-project-"));
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

const writeUser = async (servers) => {
  await mkdir(join(process.env.XDG_DATA_HOME, "projector", "agent"), { recursive: true });
  await writeFile(
    join(process.env.XDG_DATA_HOME, "projector", "agent", "mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
};
const writeProject = (servers) =>
  writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: servers }));

describe("agent MCP servers", () => {
  it("reads user and project servers, the user's winning on a name", async () => {
    await writeUser({ a: entry, off: { ...entry, disabled: true } });
    await writeProject({
      a: { type: "http", url: "http://x" },
      b: { type: "sse", url: "http://${HOST:-example}/sse" },
      bad: { type: "ftp" },
    });
    const configs = await mcpServerConfigs(project);
    expect(configs.map((item) => `${item.source}:${item.name}`)).toEqual(["user:a", "project:b"]);
    expect(configs[1].url).toBe("http://example/sse");
  });

  it("keeps only the servers a role names", async () => {
    await writeUser({ a: entry, b: entry });
    const configs = await mcpServerConfigs(project);
    expect(mcpConfigsForNames(configs, undefined).map((item) => item.name)).toEqual(["a", "b"]);
    expect(mcpConfigsForNames(configs, ["b"]).map((item) => item.name)).toEqual(["b"]);
    expect(mcpConfigsForNames(configs, [])).toEqual([]);
    expect(processMcpConfig(configs[0])).toMatchObject({
      type: "stdio",
      command: process.execPath,
    });
  });

  it("names tools without clashes or illegal characters", () => {
    expect(mcpToolName("my server", "do.it")).toBe("mcp__my_server__do_it");
    expect(mcpToolName("s", "x".repeat(100))).toHaveLength(64);
  });

  it("runs a tool of a user server; a reading tool needs no question", async () => {
    await writeUser({ echo: entry });
    const asked = [];
    const mcp = await connectMcp(project, {
      trusting: false,
      approve: async (request) => (asked.push(request.title), true),
    });
    try {
      expect(mcp.problems).toEqual([]);
      expect(Object.keys(mcp.tools).sort()).toEqual(["mcp__echo__echo", "mcp__echo__write"]);
      const echo = await mcp.tools.mcp__echo__echo.execute({ text: "привет" }, {});
      expect(echo).toBe("эхо: привет");
      expect(asked).toEqual([]);
      const written = await mcp.tools.mcp__echo__write.execute({ text: "x" }, {});
      expect(written).toBe("записано: x");
      expect(asked).toEqual(["MCP echo: write"]);
    } finally {
      await mcp.close();
    }
  });

  it("asks before starting a project server and skips it when refused", async () => {
    await writeProject({ echo: entry });
    const refused = await connectMcp(project, { trusting: false, approve: async () => false });
    expect(Object.keys(refused.tools)).toEqual([]);
    expect(refused.problems[0]).toContain("не разрешил");
    const allowed = await connectMcp(project, { trusting: false, approve: async () => true });
    try {
      expect(Object.keys(allowed.tools)).toHaveLength(2);
    } finally {
      await allowed.close();
    }
  });

  it("connects only the servers a role names", async () => {
    await writeUser({ echo: entry, other: entry });
    const mcp = await connectMcp(project, { trusting: true }, undefined, ["echo"]);
    try {
      expect(Object.keys(mcp.tools).every((name) => name.startsWith("mcp__echo__"))).toBe(true);
      expect(Object.keys(mcp.tools)).toHaveLength(2);
      expect(mcp.servers.map((server) => server.name)).toEqual(["echo"]);
    } finally {
      await mcp.close();
    }
  });

  it("reports a server that does not start without failing the rest", async () => {
    await writeUser({ broken: { command: "/nonexistent/server" }, echo: entry });
    const mcp = await connectMcp(project, { trusting: true });
    try {
      expect(mcp.problems).toHaveLength(1);
      expect(mcp.problems[0]).toContain("broken");
      expect(Object.keys(mcp.tools)).toContain("mcp__echo__echo");
    } finally {
      await mcp.close();
    }
  });
});
