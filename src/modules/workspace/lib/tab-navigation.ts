import type { ComputedRef } from "vue";
import type { DockGroup } from "../../dock/index.ts";
import type { WorkbenchLayoutContext } from "./workbench-layout.ts";

/** Команды перехода к соседней вкладке блока с фокусом: по порядку полосы, по кругу. */
export function registerTabNavigation(
  register: WorkbenchLayoutContext["register"],
  focusedGroup: ComputedRef<DockGroup | undefined>,
  selectPanel: (id: string) => void,
) {
  for (const [action, title, step] of [
    ["next", "Следующая вкладка", 1],
    ["previous", "Предыдущая вкладка", -1],
  ] as const)
    register(
      `ide.workbench.tab.${action}`,
      title,
      () => {
        const group = focusedGroup.value!;
        const index = group.panels.indexOf(group.active);
        selectPanel(group.panels[(index + step + group.panels.length) % group.panels.length]!);
      },
      () => (focusedGroup.value?.panels.length ?? 0) > 1,
      undefined,
      {
        description:
          "Переключает на соседнюю вкладку в блоке с фокусом по порядку полосы вкладок, по кругу.",
      },
    );
}
