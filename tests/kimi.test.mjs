import { expect, test } from "vite-plus/test";
import { registerBuiltinAgents } from "../server/app/agents.ts";
import { resolveAgentBackend, isAgentAvailable } from "../server/modules/agent/registry.ts";
import { acpProgram } from "../server/modules/agents/acp/acp-programs.ts";

registerBuiltinAgents();

test("Kimi registers as an ACP agent on the `kimi acp` command", () => {
  expect(resolveAgentBackend("kimi")).toBe("kimi");
  const program = acpProgram("kimi");
  expect(program.label).toBe("Kimi");
  expect(program.command).toBe("kimi");
  expect(program.args).toEqual(["acp"]);
  // The CLI is not installed on every CI runner; the registry still knows the agent.
  expect(typeof isAgentAvailable("kimi")).toBe("boolean");
});
