import type { Component } from "vue";

/** Sections belong to their owners; the workbench only renders this contract. */
export interface SettingsSection {
  id: string;
  title: string;
  group: string;
  description: string;
  keywords: string;
  component: Component;
  props?: Record<string, unknown>;
}

/** Что общая рабочая область настроек отдаёт владельцу вкладки для снапшота агента. */
export interface SettingsReadoutState {
  section: string;
  sectionTitle: string;
  query: string;
  visible: number;
}
