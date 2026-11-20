import type { Component } from "vue";
import { frozenGlass } from "@ai-projector/core/modules/appearance/index.ts";
import FrozenGlassSettings from "./FrozenGlassSettings.vue";

export const builtinThemeWidgets: ReadonlyMap<string, Component> = new Map([
  [frozenGlass.id, FrozenGlassSettings],
]);
