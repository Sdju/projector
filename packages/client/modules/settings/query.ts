import type { Component } from "vue";
import type { SettingsItem, SettingsSection } from "./sections.ts";

function haystack(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => !!part)
    .join(" ")
    .toLocaleLowerCase();
}

function itemText(item: SettingsItem): string {
  return haystack(item.title, item.description, item.keywords, item.hint);
}

function ownSectionText(section: SettingsSection): string {
  return haystack(section.title, section.group, section.description, section.keywords);
}

function matches(text: string, terms: string[]): boolean {
  return terms.every((term) => text.includes(term));
}

/** Nested nav entries that render their own form instead of the parent page. */
export function settingsPageItems(
  section: SettingsSection,
): Array<SettingsItem & { component: Component }> {
  return (section.items ?? []).filter(
    (item): item is SettingsItem & { component: Component } => !!item.component,
  );
}

/** Section that owns `selected`, whether that id is the section or one of its items. */
export function findSettingsSection(
  sections: SettingsSection[],
  selected: string,
): SettingsSection | undefined {
  return sections.find(
    (section) => section.id === selected || section.items?.some((item) => item.id === selected),
  );
}

/**
 * What the workbench should mount for `selected`: a nested form, the parent form,
 * or nothing when the section is only a group of nested pages.
 */
export function settingsPageOf(
  section: SettingsSection | undefined,
  selected: string,
): { key: string; item?: SettingsItem } | undefined {
  if (!section) return;
  const item = section.items?.find((entry) => entry.id === selected && entry.component);
  if (item) return { key: item.id, item };
  if (section.component) return { key: section.id };
  return { key: `${section.id}__index` };
}

/** Keeps a parent visible when a nested page matches, and hides siblings that do not. */
export function filterSettingsSections(
  sections: SettingsSection[],
  query: string,
): SettingsSection[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.flatMap((section) => {
    if (matches(ownSectionText(section), terms)) return [section];
    const items = section.items?.filter((item) => matches(itemText(item), terms));
    if (items?.length) return [{ ...section, items }];
    return [];
  });
}

/** Rows for `ide.settings.sections.list`, including nested pages that have their own form. */
export function listSettingsSections(sections: SettingsSection[]) {
  return sections.flatMap((section) => [
    {
      id: section.id,
      title: section.title,
      group: section.group,
      description: section.description,
      keywords: section.keywords,
    },
    ...settingsPageItems(section).map((item) => ({
      id: item.id,
      title: item.title,
      group: section.group,
      description: item.description ?? "",
      keywords: item.keywords ?? "",
    })),
  ]);
}
