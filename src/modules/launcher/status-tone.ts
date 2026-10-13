import type { LaunchInfo } from "../../../core/modules/launcher/index.ts";

/** Visual state mapping shared by the launcher list and its detail panel. */
export function launcherStatusTone(state: LaunchInfo["state"]) {
  return state === "error"
    ? "danger"
    : state === "stopping"
      ? "muted"
      : state === "idle"
        ? "faint"
        : "success";
}
