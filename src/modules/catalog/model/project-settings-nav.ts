import { ref } from "vue";

/**
 * Раздел, который показывают настройки проекта. Вкладка одна на воркспейс,
 * поэтому другие места (например, кнопка «Настроить сценарии…») выбирают раздел до её открытия.
 */
export const projectSettingsSection = ref("general");

/** Navigation id of one scenario's page, e.g. "scenario:3f2a…". */
export const scenarioSection = (id: string) => `scenario:${id}`;

/** The scenario a navigation id points at, or undefined for the other sections. */
export const scenarioOf = (section: string): string | undefined =>
  section.startsWith("scenario:") ? section.slice("scenario:".length) : undefined;
