import { expect, test } from "vite-plus/test";
import { initializeAcp, mergeClientCapabilities } from "../modules/agents/acp/acp-process.ts";
import { registerAcpProgram } from "../modules/agents/acp/index.ts";

test("shared initialize merges the program's client capabilities one level", async () => {
  const merged = mergeClientCapabilities(
    { fs: { readTextFile: false }, elicitation: { form: {} } },
    { subagents: {}, _meta: { parameterizedModelPicker: true } },
  );
  expect(merged).toEqual({
    fs: { readTextFile: false },
    elicitation: { form: {} },
    subagents: {},
    _meta: { parameterizedModelPicker: true },
  });
  registerAcpProgram({
    id: "caps-agent",
    label: "Caps",
    command: "true",
    args: [],
    clientCapabilities: { _meta: { parameterizedModelPicker: true } },
  });
  const calls = [];
  await initializeAcp(
    {
      request: async (_method, params) => {
        calls.push(params);
        return { protocolVersion: 1, agentCapabilities: { sessionCapabilities: {} } };
      },
    },
    "caps-agent",
  );
  expect(calls[0].clientCapabilities._meta).toEqual({ parameterizedModelPicker: true });
  expect(calls[0].clientCapabilities.elicitation).toEqual({ form: {} });
});
