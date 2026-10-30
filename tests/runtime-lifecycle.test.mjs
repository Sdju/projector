import { EventEmitter } from "node:events";
import { expect, onTestFinished, test, vi } from "vite-plus/test";

vi.mock("../server/app/api.ts", () => ({ handleApi: vi.fn() }));
vi.mock("../core/modules/os/index.ts", () => ({
  os: { capabilities: { nativeDesktop: false }, clearSessionEnv: vi.fn() },
}));
vi.mock("../server/modules/window/index.ts", () => ({}));
vi.mock("../server/modules/terminal/index.ts", () => ({ attachTerminalServer: vi.fn() }));
vi.mock("../server/modules/terminal-control/index.ts", () => ({
  attachSharedTerminalServer: vi.fn(),
  attachTerminalControlServer: vi.fn(),
}));
vi.mock("../server/modules/agent/index.ts", () => ({
  recoverJobs: vi.fn().mockResolvedValue(undefined),
  pruneRuns: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/modules/environments/index.ts", () => ({
  reconcileOnStartup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/app/agents.ts", () => ({ registerBuiltinAgents: vi.fn() }));
vi.mock("../server/app/widgets.ts", () => ({ registerBuiltinWidgetDefinitions: vi.fn() }));
vi.mock("../server/app/features.ts", () => ({ registerBuiltinAgentFeatures: vi.fn() }));
vi.mock("../server/modules/access/index.ts", () => ({}));
vi.mock("../server/modules/browser/index.ts", () => ({}));

test("config reload replaces the exit hook and releases the previous module callback", async () => {
  const initial = process.listeners("exit");
  const previousHook = globalThis.projectorExitHook;
  const previousMode = globalThis.projectorRuntimeMode;
  onTestFinished(() => {
    for (const hook of process.listeners("exit"))
      if (!initial.includes(hook)) process.off("exit", hook);
    for (const hook of initial)
      if (!process.listeners("exit").includes(hook)) process.on("exit", hook);
    if (previousHook) globalThis.projectorExitHook = previousHook;
    else delete globalThis.projectorExitHook;
    if (previousMode) globalThis.projectorRuntimeMode = previousMode;
    else delete globalThis.projectorRuntimeMode;
  });
  let old;
  for (let i = 0; i < 6; i++) {
    vi.resetModules();
    vi.doMock("../server/modules/instance/index.ts", () => ({
      clearInstance: vi.fn(),
      writeInstance: vi.fn().mockResolvedValue(undefined),
    }));
    const { bindRuntime } = await import("../server/app/plugin.ts");
    const { clearInstance } = await import("../server/modules/instance/index.ts");
    const server = new EventEmitter();
    server.address = () => ({ port: 4321 });
    bindRuntime(server, "dev");
    server.emit("listening");
    expect(process.listenerCount("exit")).toBe(initial.length + (previousHook ? 0 : 1));
    expect(globalThis.projectorExitHook).toBe(clearInstance);
    if (old) expect(process.listeners("exit")).not.toContain(old);
    old = clearInstance;
  }
  old();
  expect(old).toHaveBeenCalledOnce();
});
