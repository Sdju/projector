/** Where the requested capability would execute or take effect. */
export type DevcontainerRisk = "host" | "root" | "container";

/** One capability of a devcontainer.json that the restricted model refuses to grant. */
export interface DevcontainerFinding {
  id: string;
  risk: DevcontainerRisk;
  title: string;
  detail: string;
  /** Configuration keys that caused the finding. */
  keys: string[];
}
export type DevcontainerDecision = "trusted" | "declined";

export interface DevcontainerState {
  found: boolean;
  /** Path of the config relative to the project root. */
  configPath?: string;
  name?: string;
  /** Hash of the config and the files it builds from; trust is bound to it. */
  hash?: string;
  findings: DevcontainerFinding[];
  decision: DevcontainerDecision | null;
  /** A decision exists but the configuration changed after it. */
  stale: boolean;
  /** Elevated capabilities are requested and nobody has decided about this exact config. */
  needsDecision: boolean;
  /** Terminals of this project currently run inside the trusted dev container. */
  active: boolean;
}
