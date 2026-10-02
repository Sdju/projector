import { readonly, shallowRef, ref } from "vue";
import defaults from "./fallback-theme.json";
import { createFileIconResolver } from "../../../core/modules/file-icons/index.ts";

const resolver = shallowRef(createFileIconResolver(defaults));
const error = ref("");
let pending: Promise<void> | undefined;

/** Runtime JSON can be edited in public/ (dev) or dist/ (built app), without rebuilding. */
export function reloadFileIconTheme() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch("/file-icons/theme.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = createFileIconResolver(await response.json());
      resolver.value = next;
      error.value = "";
    } catch (cause) {
      // Keep the last valid theme, including bundled defaults on first load.
      error.value = "Не удалось загрузить тему иконок. Используется предыдущая тема.";
      console.warn("File icon theme:", cause);
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

let initialized = false;
export function useFileIconTheme() {
  if (!initialized) {
    initialized = true;
    void reloadFileIconTheme();
  }
  return { resolver: readonly(resolver), error: readonly(error) };
}
