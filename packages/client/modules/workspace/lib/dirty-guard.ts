import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import type { OpenFile } from "../open-file.ts";

/** Guards navigation and window close while any tab holds unsaved edits. */
export function useDirtyGuard(ctx: {
  tabs: Ref<OpenFile[]>;
  saveFile: (file?: OpenFile) => Promise<boolean>;
  isDirty: (file: OpenFile) => boolean;
}) {
  async function canLeave() {
    const results = await Promise.all(ctx.tabs.value.map((file) => ctx.saveFile(file)));
    if (results.every(Boolean)) return true;
    return window.confirm("Не удалось сохранить изменения файлов. Уйти без сохранения?");
  }
  function windowBlur() {
    for (const file of ctx.tabs.value) void ctx.saveFile(file);
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!ctx.tabs.value.some((file) => ctx.isDirty(file) || file.saving)) return;
    event.preventDefault();
    event.returnValue = "";
  }
  onBeforeRouteLeave(canLeave);
  onBeforeRouteUpdate((to, from) => to.path === from.path || canLeave());
  onMounted(() => {
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("blur", windowBlur);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("blur", windowBlur);
  });
}
