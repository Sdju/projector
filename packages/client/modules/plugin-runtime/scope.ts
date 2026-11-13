import type { DisposableLike } from "@ai-projector/plugin-api";
import { reportIssue } from "./store.ts";
export interface Scope {
  readonly signal: AbortSignal;
  readonly disposed: boolean;
  readonly plugin: string;
  add(dispose: () => void): void;
  dispose(): void;
}
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function createScope(plugin: string): Scope {
  const controller = new AbortController();
  const disposers: (() => void)[] = [];
  let isDisposed = false;
  const run = (dispose: () => void) => {
    const fail = (error: unknown) =>
      reportIssue({
        plugin,
        phase: "cleanup",
        message: messageOf(error, "Ошибка очистки плагина"),
      });
    try {
      Promise.resolve(dispose()).catch(fail);
    } catch (error) {
      fail(error);
    }
  };
  return {
    plugin,
    signal: controller.signal,
    get disposed() {
      return isDisposed;
    },
    add(dispose) {
      if (isDisposed) run(dispose);
      else disposers.push(dispose);
    },
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      controller.abort();
      for (const dispose of disposers.splice(0).reverse()) run(dispose);
    },
  };
}
export function trackResult(scope: Scope, value: DisposableLike): void {
  if (typeof value === "function") scope.add(value);
  else if (value && typeof value.dispose === "function") scope.add(() => value.dispose());
}
