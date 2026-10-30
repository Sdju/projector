import { expect, test } from "vite-plus/test";
import { listAgentBackends, registerAgentBackend } from "../server/modules/agent/index.ts";
import { registerBuiltinAgentFeatures } from "../server/app/features.ts";
import { featureSettings } from "../server/modules/agent-features/index.ts";
import { preferences, setAgentEnabled, setAgentMode } from "../server/modules/preferences/index.ts";

test("the registry lists every backend in registration order with its label and program", () => {
  const backends = listAgentBackends();
  expect(backends.map(({ id }) => id)).toEqual([
    "projector",
    "claude-code",
    "codex",
    "opencode",
    "cursor",
    "kimi",
  ]);
  const byId = Object.fromEntries(backends.map((backend) => [backend.id, backend]));
  expect(byId.projector).toMatchObject({ label: "Projector", builtin: true });
  expect(byId.projector.program).toBeUndefined();
  expect(byId["claude-code"]).toMatchObject({ label: "Claude Code", program: "claude" });
  expect(byId.codex).toMatchObject({ label: "Codex", program: "codex" });
  expect(byId.opencode).toMatchObject({ label: "OpenCode", program: "opencode" });
  expect(byId.cursor).toMatchObject({ label: "Cursor", program: "cursor" });
  expect(byId.kimi).toMatchObject({ label: "Kimi", program: "kimi" });
  expect(backends.filter((backend) => backend.builtin).map(({ id }) => id)).toEqual(["projector"]);
});

test("every agent declares how its terminal opens, with the program id as the default executable", () => {
  const byId = Object.fromEntries(listAgentBackends().map((backend) => [backend.id, backend]));
  expect(byId.projector.terminal).toBeUndefined();
  expect(byId["claude-code"].terminal).toEqual({
    program: "claude",
    executable: "claude",
    title: "Claude Code",
  });
  // The Cursor Agent CLI installs as `agent`, while the program stays `cursor`.
  expect(byId.cursor.terminal).toEqual({ program: "cursor", executable: "agent", title: "Cursor" });
  for (const id of ["codex", "opencode", "kimi"]) {
    expect(byId[id].terminal.program).toBe(id);
    expect(byId[id].terminal.executable).toBe(id);
    expect(byId[id].terminal.title).toBe(byId[id].label);
  }
  for (const backend of Object.values(byId))
    if (backend.program) expect(backend.terminal?.program).toBe(backend.program);
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
