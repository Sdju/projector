export { os, createOs, UnsupportedPlatformError, type OsAdapter } from "./os.ts";
export { clearSessionEnv, PARENT_SESSION_ENV } from "./session-env.ts";
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
  SpawnProcessSpec,
} from "./contract.ts";
