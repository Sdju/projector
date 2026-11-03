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
  /** Pages of the section listed under it in the navigation, e.g. one per run scenario. */
  items?: SettingsItem[];
  /** Makes the items draggable (and Alt+arrows movable); receives the new order of item IDs. */
  reorder?: (ids: string[]) => void;
}

/** A page nested under a section; selecting it opens the section with that page. */
export interface SettingsItem {
  id: string;
  title: string;
  /** A short note next to the title, e.g. "основной". */
  hint?: string;
  /** Marks the page as needing attention. */
  problem?: boolean;
}

/** Что общая рабочая область настроек отдаёт владельцу вкладки для снапшота агента. */
export interface SettingsReadoutState {
  section: string;
  sectionTitle: string;
  query: string;
  visible: number;
}
