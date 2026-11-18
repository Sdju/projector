import { computed, ref, type Ref } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { commandArgs } from "../../../common/utilities/commands.ts";
import type { SidebarRegistry, WorkspaceCapability } from "../../workspace-api/index.ts";

export interface WorkspaceAsideContext {
  /** Sections the profile puts on the right rail. */
  registry: SidebarRegistry;
  mobile: Ref<boolean>;
  /** The «Правая панель» setting is on (a project may override it). */
  enabled: () => boolean;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
  /** Reloads the selected section; the panel ref belongs to the workspace. */
  refresh: () => unknown;
}

/**
 * Right rail of the workspace: the aside panel behind the «Правая панель» setting. Its sections come
 * from the profile (the local workspace puts terminals there), their views from the page. The panel
 * starts expanded so terminals are visible as soon as the setting is on; narrow screens keep them in
 * the dock.
 */
export function useWorkspaceAside(ctx: WorkspaceAsideContext) {
  const available = computed(() => ctx.registry.list().length > 0);
  /** At the middle width the rail becomes a bottom panel under the editor, not a third column. */
  const middle = useMediaQuery("(min-width: 701px) and (max-width: 1050px)");
  const visible = computed(() => ctx.enabled() && available.value && !ctx.mobile.value);
  const hidden = ref(false);
  const section = ref(ctx.registry.list()[0]?.id ?? "");
  const show = () => (hidden.value = false);
  ctx.register(
    "ide.workbench.aside.toggle",
    "Показать или скрыть правую панель",
    () => (hidden.value = !hidden.value),
    () => visible.value && !middle.value,
  );
  ctx.register(
    "ide.workbench.aside.section.show",
    "Открыть раздел правой панели",
    (value) => {
      const id = commandArgs(value).section;
      if (typeof id !== "string" || !ctx.registry.has(id))
        throw new Error(
          `section: ${ctx.registry
            .list()
            .map((type) => type.id)
            .join(", ")}`,
        );
      section.value = id;
      show();
    },
    () => visible.value,
    undefined,
    {
      description:
        "Открывает раздел правой панели терминалов и показывает её. Сейчас у локального проекта один раздел — terminals.",
      arguments: { section: "Идентификатор раздела правой панели" },
    },
  );
  ctx.register(
    "ide.workbench.aside.refresh",
    "Обновить раздел правой панели",
    () => ctx.refresh(),
    () => visible.value && !hidden.value,
  );
  ctx.register(
    "ide.workbench.aside.section.close",
    "Закрыть раздел правой панели",
    (value) => {
      const id = commandArgs(value).section;
      if (typeof id !== "string" || !id) throw new Error("Укажите section");
      if (section.value === id) hidden.value = true;
    },
    () => visible.value,
    undefined,
    {
      description: "Скрывает правую панель, если закрывают её текущий раздел.",
      arguments: { section: "Идентификатор раздела правой панели" },
    },
  );
  return { available, visible, hidden, section, show, middle };
}
