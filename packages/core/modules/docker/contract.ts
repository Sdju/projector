export interface DockerContext {
  name: string;
  endpoint: string;
  local: boolean;
}
export interface DockerBinding {
  context: string;
  name: string;
  files: string[];
  profiles: string[];
  envFiles: string[];
}
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  health: string | null;
  exitCode: number;
  startedAt: string;
  project: string;
  service: string;
  workingDirectory: string;
  ports: {
    address: string;
    privatePort: number;
    publicPort: number;
    protocol: string;
    url: string | null;
  }[];
  mounts: { type: string; source: string; target: string; writable: boolean }[];
}
export interface DockerDaemonState {
  /** `missing`: no Docker CLI; `stopped`: CLI found but the daemon does not answer. */
  state: "missing" | "stopped";
  /** What starting it would run, or how to do it by hand when Projector cannot. */
  start: { label: string; auto: boolean; manual?: string };
}
export interface DockerSnapshot {
  enabled: boolean;
  context: string;
  contexts: DockerContext[];
  connected: boolean;
  version: string;
  composeVersion: string;
  error: string;
  /** Set when the daemon is not reachable and the reason is known. */
  daemon?: DockerDaemonState;
  containers: DockerContainer[];
  binding: DockerBinding | null;
  detectedFiles: string[];
}
export type DockerAction =
  | "start"
  | "stop"
  | "restart"
  | "remove"
  | "logs"
  | "shell"
  | "up"
  | "composeStop"
  | "composeRestart"
  | "down"
  | "build"
  | "pull";
