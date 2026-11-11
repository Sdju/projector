import type { PluginAgentContribution } from "@ai-projector/core/modules/plugins/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { createAcpBackend, usageReportOf, type AcpProgram } from "../acp/index.ts";

/**
 * A plugin's declarative ACP agent: the manifest names the command and its terminal, so the
 * adapter only turns it into an `AcpProgram`. No plugin code runs, and nothing beyond plain ACP
 * is added — dialects, forms, extensions and usage reporting stay off.
 */
export { loadCodeAgents, type PluginCodeApi } from "./code.ts";

export function createPluginAgent(agent: PluginAgentContribution): AgentBackend {
  const program = agent.program ?? agent.id;
  const acp: AcpProgram = {
    id: agent.id,
    label: agent.title,
    command: agent.command,
    args: agent.args ?? [],
    ...(agent.binary === undefined ? {} : { binary: agent.binary }),
    terminal: {
      program,
      executable: agent.terminal?.executable ?? program,
      title: agent.terminal?.title ?? agent.title,
      ...agent.terminal,
    },
    ...(agent.clientCapabilities === undefined
      ? {}
      : { clientCapabilities: agent.clientCapabilities }),
    notifications: {
      "projector/usage": (options, params) => {
        const report = usageReportOf(params);
        if (report) options.emit("usage", report);
      },
    },
  };
  const backend = createAcpBackend(acp);
  if (agent.caption) backend.caption = agent.caption;
  if (agent.icon) backend.icon = agent.icon;
  if (agent.usage?.kind === "command") {
    backend.usage = agent.usage;
    backend.usageUrl = `/api/agent/usage/${encodeURIComponent(agent.id)}`;
  }
  return backend;
}
