import { onBeforeUnmount, onMounted, onUnmounted, ref, type Ref } from "vue";
import type { WorkspaceProfile } from "../workspace-api/index.ts";
import { registerWorkspaceProfile, workspaceRequest } from "../workspace-api/index.ts";

/** The part of ProjectWorkspace the remote orchestration drives. */
export interface RemoteWorkspaceHandle {
  refresh: () => unknown;
  openTab: (id: string, params?: unknown, options?: { preview?: boolean }) => unknown;
  openFile: (path: string) => unknown;
}

/**
 * Loads a remote repository, registers its workspace profile and handles the unauthorised branch.
 * The host keeps API calls, profile factories and route-specific labels; lifecycle stays here.
 */
export function useRemoteWorkspace<T>(options: {
  projectId: string;
  read: (signal: AbortSignal) => Promise<T>;
  createProfile: (data: T, onMetadata: (value: T) => void) => WorkspaceProfile;
  createConnectionProfile: () => WorkspaceProfile;
  isAuthError: (error: unknown) => boolean;
  errorFallback: string;
  readmeError: string;
  connectionTab: string;
  initialPath: () => string;
}) {
  const metadata: Ref<T | undefined> = ref();
  const error = ref("");
  const needsConnection = ref(false);
  const profileReady = ref(false);
  const workspaceVersion = ref(0);
  const workspace = ref<RemoteWorkspaceHandle>();
  const controller = new AbortController();
  let disconnect: (() => void) | undefined;
  let disposed = false;
  let openedInitial = false;

  async function loadRepository() {
    error.value = "";
    try {
      const data = await options.read(controller.signal);
      if (disposed) return;
      const profile = options.createProfile(data, (value) => {
        metadata.value = value;
      });
      disconnect?.();
      disconnect = registerWorkspaceProfile(options.projectId, profile);
      metadata.value = data;
      needsConnection.value = false;
      openedInitial = false;
      workspaceVersion.value++;
      profileReady.value = true;
    } catch (err) {
      if (disposed) return;
      if (options.isAuthError(err)) {
        disconnect?.();
        disconnect = registerWorkspaceProfile(options.projectId, options.createConnectionProfile());
        metadata.value = undefined;
        needsConnection.value = true;
        openedInitial = false;
        workspaceVersion.value++;
        profileReady.value = true;
      } else error.value = err instanceof Error ? err.message : options.errorFallback;
    }
  }

  async function openInitial() {
    if (!metadata.value || (metadata.value as { empty?: boolean }).empty) return;
    const path = options.initialPath();
    if (path) return workspace.value?.openFile(path);
    const root = await workspaceRequest<{ entries: Array<{ name: string }> }>(
      options.projectId,
      "tree",
    );
    const readme = root.entries.find((entry) => /^readme\.(?:md|markdown)$/i.test(entry.name));
    if (!disposed && readme) await workspace.value?.openFile(readme.name);
  }

  function ready(instance: unknown) {
    workspace.value = instance as RemoteWorkspaceHandle | undefined;
    if (!workspace.value || openedInitial) return;
    openedInitial = true;
    if (needsConnection.value) {
      workspace.value.openTab(options.connectionTab);
      return;
    }
    void openInitial().catch((err) => {
      error.value = err instanceof Error ? err.message : options.readmeError;
    });
  }

  onMounted(loadRepository);
  onBeforeUnmount(() => {
    disposed = true;
    controller.abort();
  });
  // Child cleanup still resolves this profile; release it after the subtree unmounts.
  onUnmounted(() => disconnect?.());

  return {
    metadata,
    error,
    needsConnection,
    profileReady,
    workspaceVersion,
    workspace,
    loadRepository,
    ready,
  };
}
