import { defineAsyncComponent } from "vue";

export const TerminalView = defineAsyncComponent(() => import("./ui/TerminalView.vue"));
export { default as TerminalCloseDialog } from "./ui/TerminalCloseDialog.vue";
export { useTerminalSessions } from "./model/sessions.ts";
