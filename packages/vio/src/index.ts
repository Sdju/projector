import { onScopeDispose, type Component, type App, type ComponentPublicInstance, type ObjectDirective } from "@vue/runtime-core";
import { createRoot, createVioRenderer, type VioElement } from "./core.ts";
import { gtkDriver, installCss } from "./gtk.ts";
import type { Widget } from "./types.ts";

export * from "@vue/runtime-core";
export * from "./components.ts";
export * from "./types.ts";
export { createRoot, createVioRenderer, type VioElement, type VioNode, type VioDriver } from "./core.ts";
export { registerWidget, installCss, type WidgetDefinition, type ChildrenMode } from "./gtk.ts";

const renderer = createVioRenderer(gtkDriver);
export const render = renderer.render;
export interface VioApp extends Omit<App<VioElement>, "mount"> {
  readonly root: VioElement;
  mount(root?: VioElement): ComponentPublicInstance;
}
export function createApp(component: Component, props: Record<string, unknown> | null = null): VioApp {
  const app = renderer.createApp(component, props);
  const mount = app.mount;
  const root = createRoot();
  Object.defineProperty(app, "root", { value: root });
  app.mount = (container = root) => mount(container);
  return app as VioApp;
}

/** CSS providers follow component scope lifetime, including repeated mount/unmount. */
export function useCss(css: string) { const dispose = installCss(css); onScopeDispose(dispose); }
export function withStyles<T extends Component>(component: T, css: string, scopeId?: string): T {
  const options = component as { setup?: (...args: unknown[]) => unknown; __scopeId?: string };
  const setup = options.setup;
  // Vue uses setup.length to decide whether to create the expose/slots context.
  options.setup = function (props: unknown, context: unknown) { useCss(css); return setup?.(props, context); };
  if (scopeId) options.__scopeId = scopeId;
  return component;
}
export const vShow: ObjectDirective<VioElement, unknown> = {
  beforeMount: (node, binding) => (node.widget as Widget).setVisible(Boolean(binding.value)),
  updated: (node, binding) => (node.widget as Widget).setVisible(Boolean(binding.value)),
};
