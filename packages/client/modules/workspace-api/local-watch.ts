import { pageClientId } from "../../common/utilities/page-client.ts";
import type { WorkspaceWatch } from "./profile.ts";

/** HTTP subscriptions and the runner's shared SSE stream belong to the local provider. */
export function localWorkspaceWatch(projectId: string): WorkspaceWatch {
  return {
    update(patch, keepalive = false) {
      return fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace/watch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: pageClientId, ...patch }),
        keepalive,
      }).then(
        (response) => response.ok,
        () => false,
      );
    },
    subscribe(handlers) {
      const file = (event: Event) => {
        const detail = (event as CustomEvent<{ projectId: string; path: string }>).detail;
        if (detail.projectId === projectId) handlers.file?.(detail.path);
      };
      const directory = (event: Event) => {
        const detail = (event as CustomEvent<{ projectId: string; directory: string }>).detail;
        if (detail.projectId === projectId) handlers.directory?.(detail.directory);
      };
      const error = (event: Event) => {
        const detail = (event as CustomEvent<{ projectId: string; message: string }>).detail;
        if (detail.projectId === projectId) handlers.error?.(detail.message);
      };
      const reconnect = () => handlers.reconnect?.();
      window.addEventListener("projector:file-changed", file);
      window.addEventListener("projector:dir-changed", directory);
      window.addEventListener("projector:watch-error", error);
      window.addEventListener("projector:events-open", reconnect);
      return () => {
        window.removeEventListener("projector:file-changed", file);
        window.removeEventListener("projector:dir-changed", directory);
        window.removeEventListener("projector:watch-error", error);
        window.removeEventListener("projector:events-open", reconnect);
      };
    },
  };
}
