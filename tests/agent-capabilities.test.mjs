import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { createState } from "../src/modules/agent/model/chat-state.ts";
import { useExternalAgent } from "../src/modules/agent/model/external.ts";
import { useChatActions } from "../src/modules/agent/model/chat-actions.ts";
import { registerAgentCommands } from "../src/modules/agent/model/agent-commands.ts";
import { registerChat } from "../src/modules/agent/model/chat-registry.ts";
import { agentCapabilities, agentControls } from "../server/modules/agent/registry.ts";
import { claudeCodeBackend } from "../server/modules/agents/claude-code/claude-code-backend.ts";

test("permission policy is the same control for the UI and IDE commands and is saved", async () => {
  const offered = await agentControls("claude-code", "/tmp");
  const requests = [];
  vi.stubGlobal("fetch", async (url, options) => {
    requests.push({ url, options });
    return Response.json(
      url.includes("controls")
        ? { controls: offered, capabilities: agentCapabilities("claude-code") }
        : { defaults: {} },
    );
  });
  onTestFinished(() => vi.unstubAllGlobals());
  const state = createState();
  state.permissionMode = "plan"; // A chat that was already open before HMR.
  const model = useExternalAgent(state, {
    backend: "claude-code",
    projectId: "policy-test",
    ready: Promise.resolve(),
    persist() {},
  });
  await model.loadControls();
  const dispose = registerChat({
    key: "policy",
    projectId: "policy-test",
    backend: "claude-code",
    visible: () => true,
    busy: () => false,
    controls: () => model.controls.value,
    setControl: model.setControl,
  });
  onTestFinished(dispose);
  const commands = new Map();
  registerAgentCommands((id, title, run) => commands.set(id, run), "policy-test");
  expect(
    commands
      .get("ide.agent.controls.list")()
      .find((item) => item.id === "permission-mode"),
  ).toMatchObject({
    current: "plan",
    options: expect.arrayContaining(["default", "plan", "acceptEdits"]),
  });
  await commands.get("ide.agent.control.set")({ id: "permission-mode", value: "acceptEdits" });
  expect(model.controls.value.find((item) => item.id === "permission-mode").current).toBe(
    "acceptEdits",
  );
  expect(state.selection["permission-mode"]).toBe("acceptEdits");
  expect(JSON.parse(requests.at(-1).options.body)).toMatchObject({
    id: "permission-mode",
    value: "acceptEdits",
  });
  await expect(model.setControl("permission-mode", "unknown")).rejects.toThrow(/нет значения/);
});

test("file rewind and session branching depend on adapter capabilities, not its name", () => {
  const state = createState();
  state.turns = [
    { id: "u1", role: "user", text: "one", tools: [] },
    { id: "a1", role: "assistant", text: "ok", tools: [], tail: "tail", session: { id: "s" } },
    { id: "u2", role: "user", text: "two", tools: [] },
    { id: "a2", role: "assistant", text: "ok", tools: [] },
  ];
  const actions = useChatActions(state, {
    backend: "codex",
    projectId: "p",
    ready: Promise.resolve(),
    persist() {},
    async send() {},
    stop() {},
  });
  expect(actions.canRewindFiles("u1")).toBe(false);
  state.capabilities = { rewindFiles: true, branchSession: true };
  expect(actions.canRewindFiles("u1")).toBe(true);
  actions.edit("u2");
  actions.applyEdit();
  expect(state.turns.at(-1).detached).toBeUndefined();
  expect(agentCapabilities("claude-code")).toMatchObject({
    inject: true,
    editSessions: true,
    rewindFiles: true,
  });
  expect(agentCapabilities("codex").rewindFiles).toBe(false);
});

test("new chats use the latest saved policy and concurrent control saves keep each choice", async () => {
  const offered = await agentControls("claude-code", "/tmp");
  const pending = [];
  let failSave = false;
  vi.stubGlobal("fetch", async (url, options) => {
    if (options?.method === "PUT") {
      if (failSave) throw new Error("save failed");
      await new Promise((resolve) => pending.push(resolve));
      return Response.json({});
    }
    return Response.json(
      url.includes("controls") ? { controls: offered, capabilities: {} } : { defaults: {} },
    );
  });
  onTestFinished(() => vi.unstubAllGlobals());
  const make = () => {
    const state = createState();
    return {
      state,
      model: useExternalAgent(state, {
        backend: "claude-code",
        projectId: "saved-policy",
        ready: Promise.resolve(),
        persist() {},
      }),
    };
  };
  const initial = make();
  await initial.model.loadControls();
  const bypass = initial.model.setControl("permission-mode", "bypassPermissions");
  pending.shift()();
  await bypass;
  const first = make();
  await first.model.loadControls();
  expect(first.state.selection["permission-mode"]).toBe("bypassPermissions");
  const policy = first.model.setControl("permission-mode", "default");
  const modelOption = offered.find((control) => control.id === "model").options.at(-1).value;
  const model = first.model.setControl("model", modelOption);
  pending.pop()();
  await model;
  pending.shift()();
  await policy;
  const second = make();
  await second.model.loadControls();
  expect(second.state.selection).toMatchObject({
    "permission-mode": "default",
    model: modelOption,
  });
  failSave = true;
  await second.model.setControl("permission-mode", "bypassPermissions");
  const third = make();
  await third.model.loadControls();
  expect(second.state.error).toBe("save failed");
  expect(third.state.selection["permission-mode"]).toBe("default");
});

test("a raw run cannot supply an unsupported permission policy", async () => {
  await expect(
    claudeCodeBackend.run({ cwd: "/tmp", selection: { "permission-mode": "unknown" } }),
  ).rejects.toThrow(/Неизвестный режим/);
});
