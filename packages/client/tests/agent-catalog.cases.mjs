import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vite-plus/test";
import IconBot from "~icons/lucide/bot";
import { registerBuiltinClientAgents } from "../app/agents.ts";
import {
  clientAgents,
  iconFromSvg,
  iconNodesFromSvg,
  registerClientAgent,
  refreshClientAgents,
} from "../modules/agents-integration/catalog/index.ts";

registerBuiltinClientAgents();

function serve(backends) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ backends }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

test("plugin agents join the client catalog and disappear when the server drops them", async () => {
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });

  serve([
    {
      id: "plugin-catalog-test",
      label: "Plugin Agent",
      caption: "Запустит плагинного агента",
      icon: "sparkles",
      program: "plugin-chat",
    },
  ]);
  await refreshClientAgents();
  const agent = clientAgents().find((item) => item.backend === "plugin-catalog-test");
  expect(agent).toMatchObject({
    title: "Plugin Agent",
    caption: "Запустит плагинного агента",
    program: "plugin-chat",
  });
  expect(agent.icon).toBeTruthy();
  expect(agent.usage).toBeUndefined();

  serve([]);
  await refreshClientAgents();
  expect(clientAgents().some((item) => item.backend === "plugin-catalog-test")).toBe(false);
});

test("a plugin SVG icon and plan tools hydrate into the client catalog", async () => {
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h1"/></svg>';
  serve([
    {
      id: "plugin-icon-test",
      label: "Icon Agent",
      program: "icon-chat",
      iconSvg: svg,
      plan: { tools: ["create_plan", "update_todos"] },
    },
  ]);
  await refreshClientAgents();
  const agent = clientAgents().find((item) => item.backend === "plugin-icon-test");
  expect(agent.plan).toBeTypeOf("function");
  expect(
    agent.plan({
      name: "update_todos",
      input: JSON.stringify({ todos: [{ content: "one", status: "completed" }] }),
    }),
  ).toEqual([{ content: "one", status: "completed" }]);
  expect(agent.icon).not.toBe(IconBot);
  const nodes = iconNodesFromSvg(svg);
  expect(nodes.children).toHaveLength(1);
  expect(nodes.children[0].type).toBe("path");
  expect(nodes.children[0].props.d).toBe("M1 1h1");
  expect(iconFromSvg(svg)).toBeTruthy();

  serve([]);
  await refreshClientAgents();
  expect(clientAgents().some((item) => item.backend === "plugin-icon-test")).toBe(false);
});

test("the Cursor plugin SVG keeps a drawable path after sanitizing", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../plugins/cursor/icons/cursor.svg", import.meta.url)),
    "utf8",
  );
  const nodes = iconNodesFromSvg(source);
  expect(nodes.viewBox).toBe("0 0 24 24");
  expect(nodes.children).toHaveLength(1);
  expect(nodes.children[0].type).toBe("path");
  expect(nodes.children[0].props.d).toMatch(/^M11\.503/);
});

test("a plugin agent keeps its local icon, plan and limits when enabled after a refresh", async () => {
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  const plan = () => [{ content: "kept", status: "pending" }];
  registerClientAgent({
    backend: "plugin-late-test",
    program: "plugin-late",
    title: "Late Agent",
    caption: "Появится позже",
    icon: IconBot,
    plugin: true,
    plan,
  });
  serve([]);
  await refreshClientAgents();
  expect(clientAgents().some((item) => item.backend === "plugin-late-test")).toBe(false);

  serve([{ id: "plugin-late-test", label: "Late Agent", program: "plugin-late" }]);
  await refreshClientAgents();
  const agent = clientAgents().find((item) => item.backend === "plugin-late-test");
  expect(agent).toMatchObject({ title: "Late Agent", caption: "Появится позже" });
  expect(agent.plan).toBe(plan);
});

test("a local descriptor wins over the same backend from the server", async () => {
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  registerClientAgent({
    backend: "local-catalog-test",
    program: "local-chat",
    title: "Local Agent",
    caption: "Локальный агент",
    icon: IconBot,
  });
  serve([
    {
      id: "local-catalog-test",
      label: "Server Agent",
      program: "local-chat",
    },
  ]);
  await refreshClientAgents();
  expect(clientAgents().find((item) => item.backend === "local-catalog-test")?.title).toBe(
    "Local Agent",
  );
});

test("the server fills missing limits and their window labels into a local descriptor", async () => {
  const original = globalThis.fetch;
  onTestFinished(() => {
    globalThis.fetch = original;
  });
  registerClientAgent({
    backend: "local-usage-test",
    program: "local-usage",
    title: "Local Usage",
    caption: "Локальный индикатор",
    icon: IconBot,
    plugin: true,
  });
  serve([
    {
      id: "local-usage-test",
      label: "Server Usage",
      program: "local-usage",
      usageUrl: "/api/agent/usage/local-usage-test",
      usageWindows: [{ name: "total", label: "Всего", shortLabel: "вс", periodSeconds: 2592000 }],
    },
  ]);
  await refreshClientAgents();
  const agent = clientAgents().find((item) => item.backend === "local-usage-test");
  expect(agent).toMatchObject({
    title: "Local Usage",
    usageUrl: "/api/agent/usage/local-usage-test",
  });
  expect(agent.usage).toBeUndefined();
  expect(agent.usageProps).toMatchObject({
    agentId: "local-usage-test",
    windows: [{ name: "total", label: "Всего", shortLabel: "вс", periodSeconds: 2592000 }],
  });

  serve([]);
  await refreshClientAgents();
  expect(clientAgents().some((item) => item.backend === "local-usage-test")).toBe(false);
});
