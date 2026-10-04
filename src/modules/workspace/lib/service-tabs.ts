import type { Ref } from "vue";
import type { TabParams, TabRegistry } from "../../workspace-api/index.ts";
import type { OpenFile } from "../open-file.ts";
import { opensAsPreview } from "./preview-tabs.ts";

/** Adds the tab of a registered kind unless it is already open; returns its key. */
export function ensureTab(
  tabs: Ref<OpenFile[]>,
  registry: TabRegistry,
  id: string,
  params: TabParams = {},
  preview = false,
) {
  const type = registry.get(id);
  if (!type) return undefined;
  const key = type.key(params);
  const existing = tabs.value.find((tab) => tab.key === key);
  const asPreview = opensAsPreview(preview && !!type.preview, existing);
  if (existing) existing.preview = asPreview;
  else
    tabs.value.push({
      key,
      path: type.path(params),
      virtual: id,
      content: type.hint?.(params) ?? "",
      params,
      preview: asPreview,
    });
  return key;
}
