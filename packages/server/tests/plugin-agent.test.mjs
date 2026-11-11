import { expect, test } from "vite-plus/test";
import { acpProgram } from "../modules/agents/acp/acp-programs.ts";
import { createPluginAgent } from "../modules/agents/plugin/index.ts";

test("a plugin agent becomes a plain ACP backend", () => {
  const capabilities = { _meta: { source: "fixture" } };
  const backend = createPluginAgent({
    id: "fixture-agent",
    title: "Fixture Agent",
    caption: "Chats through the fixture ACP server",
    program: "fixture-chat",
    terminal: { executable: "fixture-bin" },
    command: "node",
    args: ["acp.js"],
    binary: "fixture-acp",
    clientCapabilities: capabilities,
  });

  expect(backend.id).toBe("fixture-agent");
  expect(backend.label).toBe("Fixture Agent");
  expect(backend.program).toBe("fixture-chat");
  expect(backend.terminal).toStrictEqual({
    program: "fixture-chat",
    executable: "fixture-bin",
    title: "Fixture Agent",
  });
  expect(backend.capabilities?.hosted).toBe(true);
  for (const method of ["run", "controls", "commands", "sessions"]) {
    expect(typeof backend[method]).toBe("function");
  }

  const program = acpProgram("fixture-agent");
  expect(program).toMatchObject({
    id: "fixture-agent",
    label: "Fixture Agent",
    command: "node",
    args: ["acp.js"],
    binary: "fixture-acp",
    clientCapabilities: capabilities,
  });
  expect(program.dialect).toBeUndefined();
  expect(program.forms).toBeUndefined();
  expect(program.extensions).toBeUndefined();
});

test("a plugin agent without a program falls back to its id", () => {
  const backend = createPluginAgent({
    id: "fixture-plain",
    title: "Plain Fixture",
    command: "fixture-plain",
  });

  expect(backend.program).toBe("fixture-plain");
  expect(backend.terminal).toStrictEqual({
    program: "fixture-plain",
    executable: "fixture-plain",
    title: "Plain Fixture",
  });
  expect(acpProgram("fixture-plain")).toMatchObject({ args: [] });
  expect(acpProgram("fixture-plain").binary).toBeUndefined();
  expect(acpProgram("fixture-plain").clientCapabilities).toBeUndefined();
});

test("an explicit terminal program overrides the agent program", () => {
  const backend = createPluginAgent({
    id: "fixture-terminal",
    title: "Terminal Fixture",
    program: "fixture-chat",
    terminal: { program: "fixture-terminal-bin", title: "Fixture Shell" },
    command: "fixture-terminal",
  });

  expect(backend.terminal).toStrictEqual({
    program: "fixture-terminal-bin",
    executable: "fixture-chat",
    title: "Fixture Shell",
  });
  // The ACP backend reports the terminal program as its own, like every built-in agent.
  expect(backend.program).toBe("fixture-terminal-bin");
});
