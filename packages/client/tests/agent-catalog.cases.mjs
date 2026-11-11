import { expect, onTestFinished, test } from "vite-plus/test";
import IconBot from "~icons/lucide/bot";
import { registerBuiltinClientAgents } from "../app/agents.ts";
import {
  clientAgents,
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
