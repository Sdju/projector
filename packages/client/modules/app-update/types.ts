import type { InstallSource } from "@ai-projector/core/modules/app-update/index.ts";

export interface AppUpdateAddon {
  version?: string;
  latest?: string;
  lockstep: boolean;
}

export interface AppUpdateSnapshot {
  version?: string;
  source: InstallSource;
  latest?: string;
  outdated: boolean;
  offer: boolean;
  inbox: boolean;
  dismissed?: string;
  checkedAt?: string;
  command?: string;
  notesUrl?: string;
  restart: boolean;
  native?: AppUpdateAddon;
  hub?: AppUpdateAddon;
  error?: string;
}
