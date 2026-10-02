export { default as ProjectWorkspace } from "./ui/ProjectWorkspace.vue";
import { defineAsyncComponent } from "vue";
export const EditorSettings = defineAsyncComponent(() => import("./ui/EditorSettings.vue"));
