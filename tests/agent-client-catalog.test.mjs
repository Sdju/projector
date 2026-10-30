import { expect, test } from "vite-plus/test";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";
import {
  clientAgentByBackend,
  clientAgentOf,
  clientAgentPrograms,
  clientAgents,
} from "../src/modules/agents-integration/catalog/index.ts";
import { createLocalWorkspaceProfile } from "../src/modules/workspace-api/index.ts";
import { jobChatTab } from "../src/modules/agent/lib/job-labels.ts";

registerBuiltinClientAgents();

test("the client catalog registers the built-in and external agents in order", () => {
  expect(clientAgents().map((agent) => agent.backend)).toEqual([
    "projector",
    "claude-code",
    "codex",
    "opencode",
    "cursor",
    "kimi",
  ]);
  expect(clientAgentPrograms()).toEqual(["claude", "codex", "opencode", "cursor", "kimi"]);
  expect(clientAgentOf("claude").backend).toBe("claude-code");
  expect(clientAgentByBackend("claude-code").title).toBe("Claude Code");
  expect(clientAgentOf("projector")).toBeUndefined();
  expect(clientAgentByBackend("projector")).toMatchObject({ builtin: true, title: "Projector" });
});

test("registering again replaces an agent and keeps the order", () => {
  registerBuiltinClientAgents();
  expect(clientAgents().map((agent) => agent.backend)).toEqual([
    "projector",
    "claude-code",
    "codex",
    "opencode",
    "cursor",
    "kimi",
  ]);
  expect(clientAgents()).toHaveLength(6);
});

test("the local workspace profile builds its tabs from the catalog", () => {
  const tabs = createLocalWorkspaceProfile("p").tabs ?? [];
  expect(tabs.map((tab) => tab.id)).toEqual([
    "agent",
    "claude",
    "codex",
    "opencode",
    "cursor",
    "kimi",
    "agent-task",
    "agent-job",
    "project",
    "docker",
  ]);
  expect(tabs.find((tab) => tab.id === "claude")?.command?.id).toBe("ide.workbench.claude.open");
  expect(tabs.find((tab) => tab.id === "kimi")?.title?.({})).toBe("Kimi в графическом чате");
});

test("a job continues in the chat of its external agent only", () => {
  expect(jobChatTab("claude-code")).toBe("claude");
  expect(jobChatTab("projector")).toBeUndefined();
  expect(jobChatTab("unknown")).toBeUndefined();
});
