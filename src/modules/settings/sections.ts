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
