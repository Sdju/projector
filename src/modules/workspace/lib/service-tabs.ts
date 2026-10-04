import type { Ref } from "vue";
import type { OpenFile } from "../open-file.ts";
import { virtualTabs } from "./virtual-tabs.ts";

type ServiceTab = keyof typeof virtualTabs;

/** Opens a single service tab and focuses it, creating it on first use. */
export function openServiceTab(
  tabs: Ref<OpenFile[]>,
  selectTab: (key: string) => void,
  kind: ServiceTab,
) {
  const { key, path } = virtualTabs[kind];
  if (!tabs.value.some((tab) => tab.key === key))
    tabs.value.push({ key, path, virtual: kind, content: "" });
  selectTab(key);
}

/** Opens the discussion tab of a single issue; each issue gets its own tab. */
export function openIssueTab(
  tabs: Ref<OpenFile[]>,
  selectTab: (key: string) => void,
  issue: { number: number; title?: string },
) {
  const key = `issue:${issue.number}`;
  if (!tabs.value.some((tab) => tab.key === key))
    tabs.value.push({
      key,
      virtual: "issue",
      path: `Issue #${issue.number}`,
      content: issue.title || "",
      issue: issue.number,
    });
  selectTab(key);
}
