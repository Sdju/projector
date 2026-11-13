import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import { dataDir } from "../../../packages/core/modules/app-paths/index.ts";
import { pluginCommandPrefix } from "../../../packages/core/modules/plugins/index.ts";
import { listAgentBackends } from "../../../packages/server/modules/agent/index.ts";
import {
  installPlugin,
  pluginsDirectory,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
} from "../../../packages/server/modules/plugins/index.ts";
import { registerBuiltinAgents, syncPluginAgents } from "../../../packages/server/app/agents.ts";
import { processMcpConfig } from "../src/mcp.ts";
import { claudeToolMeta } from "../src/tools.ts";
import { createClaudeEventMapper } from "../src/claude-code-events.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = join(root, "plugins/claude-code");
const pluginId = "@projector/claude-code-agent";
const sdkName = "@anthropic-ai/claude-agent-sdk";

beforeEach(async () => {
  await rm(pluginsDirectory(), { recursive: true, force: true });
  await rm(join(dataDir(), "plugins.json"), { force: true });
});

async function cleanup() {
  try {
    await removePlugin(pluginId);
  } catch {
    /* The package may already be gone. */
  }
}

function buildPlugin() {
  execFileSync("vp", ["run", "build:plugin:claude-code"], { cwd: root, stdio: "ignore" });
}

async function stubSdk(directory) {
  const sdk = join(directory, "node_modules", "@anthropic-ai", "claude-agent-sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({ name: sdkName, version: "0.3.291", main: "index.js" }),
  );
  await writeFile(join(sdk, "index.js"), "module.exports = {};\n");
}

function fakeElement(doc, tag) {
  const listeners = new Map();
  return {
    tagName: String(tag).toUpperCase(),
    style: { cssText: "" },
    className: "",
    type: "",
    textContent: "",
    hidden: false,
    children: [],
    ownerDocument: doc,
    setAttribute() {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
}

function fakeDocument() {
  const doc = { defaultView: globalThis };
  doc.createElement = (tag) => fakeElement(doc, tag);
  return doc;
}

test("the Claude Code plugin installs, trusts, loads its code entry and disappears when disabled", async () => {
  onTestFinished(cleanup);
  buildPlugin();
  const source = await mkdtemp(join(tmpdir(), "projector-claude-code-plugin-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  await cp(pluginRoot, source, {
    recursive: true,
    filter: (path) => !path.includes(`${join(pluginRoot, "node_modules")}`),
  });
  await stubSdk(source);

  const installed = await installPlugin(source);
  const plugin = installed.plugins.find((item) => item.id === pluginId);
  expect(plugin).toMatchObject({ enabled: false, trusted: false, code: true });
  expect(plugin.dependencies).toEqual({ [sdkName]: "^0.3.291" });
  expect(plugin.browser?.entry).toBe("dist/browser.js");
  expect(plugin.agents.map((agent) => agent.id)).toEqual(["claude-code"]);
  expect(plugin.agents[0].defaultFeatures).toEqual(["widgets"]);
  expect(plugin.agents[0].command).toBeUndefined();

  await expect(setPluginEnabled(pluginId, true)).rejects.toThrow(/доверие/);
  await trustPlugin(pluginId);
  await setPluginEnabled(pluginId, true);

  registerBuiltinAgents();
  await syncPluginAgents();

  const backend = listAgentBackends().find((item) => item.id === "claude-code");
  expect(backend).toMatchObject({
    id: "claude-code",
    label: "Claude Code",
    caption: "Запустит агента Anthropic",
    program: "claude",
    terminal: { program: "claude", executable: "claude", title: "Claude Code" },
    plan: { tools: ["TodoWrite"] },
    usageUrl: "/api/agent/usage/claude-code",
    defaultFeatures: ["widgets"],
    capabilities: { hosted: true, inject: true, branchSession: true },
  });
  expect(backend.defaultFeatures).toContain("widgets");
  expect(backend.iconSvg).toMatch(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(backend.iconSvg).toMatch(/viewBox="0 0 24 24"/);
  expect(backend.usageWindows?.map((window) => window.name)).toEqual(["weekly", "rolling"]);

  await setPluginEnabled(pluginId, false);
  expect(listAgentBackends().some((item) => item.id === "claude-code")).toBe(false);
});

test("processMcpConfig maps stdio, http and sse configs", () => {
  expect(
    processMcpConfig({
      name: "stdio",
      source: "user",
      command: "npx",
      args: ["-y", "echo"],
      env: { TOKEN: "1" },
    }),
  ).toEqual({ type: "stdio", command: "npx", args: ["-y", "echo"], env: { TOKEN: "1" } });
  expect(
    processMcpConfig({
      name: "http",
      source: "project",
      url: "https://example/mcp",
      sse: false,
      headers: { Authorization: "Bearer x" },
    }),
  ).toEqual({
    type: "http",
    url: "https://example/mcp",
    headers: { Authorization: "Bearer x" },
  });
  expect(
    processMcpConfig({
      name: "sse",
      source: "user",
      url: "https://example/sse",
      sse: true,
      headers: {},
    }),
  ).toEqual({ type: "sse", url: "https://example/sse", headers: {} });
});

test("claudeToolMeta and the event mapper emit kind, label and paths", () => {
  expect(claudeToolMeta("Read", { file_path: "a.ts" })).toEqual({
    kind: "read",
    label: "Чтение файла",
  });
  expect(claudeToolMeta("Write", { file_path: "a.ts" })).toEqual({
    kind: "write",
    label: "Запись файла",
    paths: ["a.ts"],
  });
  expect(claudeToolMeta("MultiEdit", { filePath: "b.ts" })).toEqual({
    kind: "edit",
    label: "Правка файла",
    paths: ["b.ts"],
  });
  expect(claudeToolMeta("Skill", { name: "lint" })).toEqual({});

  const events = [];
  const mapper = createClaudeEventMapper((event, data) => events.push([event, data]));
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "m1",
      content: [
        { type: "tool_use", id: "t1", name: "Write", input: { file_path: "src/a.ts" } },
        { type: "tool_use", id: "t2", name: "Skill", input: { name: "release" } },
      ],
    },
  });
  expect(events[0]).toEqual([
    "tool",
    {
      id: "t1",
      name: "Write",
      input: { file_path: "src/a.ts" },
      kind: "write",
      label: "Запись файла",
      paths: ["src/a.ts"],
    },
  ]);
  expect(events[1]).toEqual(["tool", { id: "t2", name: "Skill", input: { name: "release" } }]);
});

test("dist/browser.js activates plan, toolLabel and mountUsage", async () => {
  buildPlugin();
  const module = await import(pathToFileURL(join(pluginRoot, "dist/browser.js")).href);
  const registered = { commands: [], agents: [] };
  const api = {
    apiVersion: 1,
    packageName: pluginId,
    packageVersion: "1.0.0",
    device: "",
    signal: new AbortController().signal,
    assetUrl: (path) => path,
    languages: { register() {} },
    panels: { register() {} },
    tabs: { register() {} },
    commands: {
      prefix: pluginCommandPrefix(pluginId),
      register: (contribution) => {
        registered.commands.push(contribution);
        return { dispose() {} };
      },
    },
    agents: {
      register: (contribution) => {
        registered.agents.push(contribution);
        return { dispose() {} };
      },
    },
    onDispose() {},
  };
  expect(module.default.apiVersion).toBe(1);
  await module.default.activate(api);
  expect(registered.commands.map((item) => item.id)).toEqual([
    pluginCommandPrefix(pluginId) + "usage.window.cycle",
  ]);
  expect(registered.agents.map((item) => item.id)).toEqual(["claude-code"]);

  const { plan, toolLabel, mountUsage } = registered.agents[0];
  expect(
    plan({
      name: "TodoWrite",
      input: JSON.stringify({
        todos: [{ content: "one", status: "in_progress", activeForm: "Doing one" }],
      }),
    }),
  ).toEqual([{ content: "one", status: "in_progress", active: "Doing one" }]);
  expect(toolLabel({ name: "MultiEdit" })).toBe("Правка файла");

  const previousFetch = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = async (url) => {
    expect(String(url)).toBe("/api/agent/usage/claude-code");
    return Response.json({
      status: "ready",
      windows: {
        weekly: { usedPercent: 10, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
        rolling: { usedPercent: 40, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
      },
      checkedAt: Date.now(),
    });
  };

  const doc = fakeDocument();
  const container = fakeElement(doc, "div");
  let published;
  const controller = new AbortController();
  const dispose = await mountUsage(container, {
    agentId: "claude-code",
    title: "Claude Code",
    usageUrl: "/api/agent/usage/claude-code",
    device: "",
    signal: controller.signal,
    assetUrl: (path) => path,
    commands: { run: async () => {} },
    publishSummary(remaining, tone) {
      published = { remaining, tone };
    },
  });
  const until = Date.now() + 2000;
  while (published?.remaining == null && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(published.remaining).toBe(90);
  expect(["spare", "normal", "hot", "over"]).toContain(published.tone);
  expect(container.children.length).toBeGreaterThan(0);
  dispose();
  expect(container.children).toEqual([]);
});
