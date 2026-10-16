export { os, createOs, UnsupportedPlatformError, type OsAdapter } from "./os.ts";
export { clearAgentSession } from "./session-env.ts";
export { bashShellLaunch } from "./bash.ts";
export type {
  ProcessInfo,
  DesktopAction,
  DockerStartPlan,
  DesktopPalette,
  ResidentOptions,
  SecretKey,
  ShellLaunch,
  AgentProcess,
  AgentHostSpec,
  AgentProcessSpec,
} from "./contract.ts";
