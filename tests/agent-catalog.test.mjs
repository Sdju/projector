import { expect, test } from "vite-plus/test";
import { listAgentBackends, registerAgentBackend } from "../server/modules/agent/index.ts";
import { registerBuiltinAgentFeatures } from "../server/app/features.ts";
import { featureSettings } from "../server/modules/agent-features/index.ts";
import { preferences, setAgentEnabled, setAgentMode } from "../server/modules/preferences/index.ts";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";
import { clientAgents } from "../src/modules/agents-integration/catalog/index.ts";

registerBuiltinClientAgents();

test("the server and client agree on agent identity and terminal programs", () => {
  const backends = listAgentBackends();
  const clients = clientAgents();
  expect(clients.map(({ backend }) => backend).sort()).toEqual(backends.map(({ id }) => id).sort());
  for (const backend of backends) {
    const client = clients.find((agent) => agent.backend === backend.id);
    expect(!!client.builtin, backend.id).toBe(!!backend.builtin);
    if (!backend.builtin) {
      expect(client.program, backend.id).toBe(backend.program);
      expect(backend.terminal?.program, backend.id).toBe(client.program);
    }
  }
});

test("a new backend reaches the feature switches, the on/off setting and the chat mode", async () => {
  registerAgentBackend({
    id: "fake-agent",
    label: "Fake Agent",
    program: "fake-chat",
    run: async () => {},
  });
  // The composition runs this after registration, as it does at startup.
  registerBuiltinAgentFeatures();

  const settings = await featureSettings();
  const widgets = settings.features.find((feature) => feature.id === "widgets");
  expect(widgets.agents.find((agent) => agent.id === "fake-agent")).toMatchObject({
    label: "Fake Agent",
    enabled: false,
  });

  await setAgentEnabled("fake-agent", false);
  expect((await preferences()).disabledAgents).toContain("fake-agent");
  await setAgentEnabled("fake-agent", true);
  expect((await preferences()).disabledAgents).not.toContain("fake-agent");

  await setAgentMode("fake-chat", "gui");
  expect((await preferences()).agentModes["fake-chat"]).toBe("gui");
  await setAgentMode("fake-chat", "tui");
  expect((await preferences()).agentModes["fake-chat"]).toBeUndefined();
});
