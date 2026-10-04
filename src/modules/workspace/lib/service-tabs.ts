import type { Ref } from "vue";
import type { TabParams, TabRegistry } from "../../workspace-api/index.ts";
import type { OpenFile } from "../open-file.ts";

/** Adds the tab of a registered kind unless it is already open; returns its key. */
export function ensureTab(
  tabs: Ref<OpenFile[]>,
  registry: TabRegistry,
  id: string,
  params: TabParams = {},
) {
  const type = registry.get(id);
  if (!type) return undefined;
  const key = type.key(params);
  if (!tabs.value.some((tab) => tab.key === key))
    tabs.value.push({
      key,
      path: type.path(params),
      virtual: id,
      content: type.hint?.(params) ?? "",
      params,
    });
  return key;
}
