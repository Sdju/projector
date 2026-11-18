import { computed, onMounted, ref, type Ref } from "vue";
import { commandArgs } from "../../../common/utilities/commands.ts";
import type { WorkspaceCapability } from "../../workspace-api/index.ts";

/**
 * Global preference of this machine: the old right rail of the workbench is enabled.
 * A project overrides it locally through the workspace session.
 */
export const rightPanelPreference = ref(false);
let loaded = false;
let pending: Promise<void> | undefined;

async function settings(init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch("/api/launcher/settings", { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : "Не удалось прочитать настройку правой панели",
    );
  return data as Record<string, unknown>;
}

/** Reads the global value once; a failed request keeps the default (off). */
export function loadRightPanelPreference(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  if (pending) return pending;
  pending = settings()
    .then((data) => {
      rightPanelPreference.value = data.rightPanel === true;
      loaded = true;
    })
    .catch(() => undefined)
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

/** Saves the global value; a project may still override it in its session. */
export async function saveRightPanelPreference(enabled: boolean): Promise<boolean> {
  const data = await settings({ method: "PUT", body: JSON.stringify({ rightPanel: enabled }) });
  rightPanelPreference.value = data.rightPanel === true;
  loaded = true;
  return rightPanelPreference.value;
}

/** Project value (`override`) on top of the global setting; the session stores it. */
export function useRightPanelPreference() {
  const override = ref<boolean | undefined>();
  const enabled = computed(() => override.value ?? rightPanelPreference.value);
  onMounted(() => {
    void loadRightPanelPreference();
  });
  return { override, enabled };
}

export type RegisterWorkspaceCommand = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: WorkspaceCapability,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

export interface RightPanelCommandsContext {
  /** Project override stored in the workspace session. */
  override: Ref<boolean | undefined>;
  enabled: () => boolean;
  register: RegisterWorkspaceCommand;
}

/** Project-level override of the global «Правая панель» setting. */
export function registerRightPanelCommands(ctx: RightPanelCommandsContext) {
  ctx.register(
    "ide.workbench.rightPanel.toggle",
    "Включить или выключить правую панель для проекта",
    (value) => {
      const { enabled } = commandArgs(value);
      if (enabled !== undefined && typeof enabled !== "boolean")
        throw new Error("enabled: boolean");
      ctx.override.value = enabled ?? !ctx.enabled();
    },
    () => true,
    undefined,
    {
      description:
        "Переопределяет для этого проекта глобальную настройку «Правая панель» и сохраняет выбор в сессии проекта. Без enabled переключает состояние.",
      arguments: { enabled: "boolean (необязательно): включить (true) или выключить (false)" },
    },
  );
}
