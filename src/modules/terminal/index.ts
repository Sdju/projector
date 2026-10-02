import { defineAsyncComponent } from "vue";

export const TerminalPane = defineAsyncComponent(() => import("./ui/TerminalPane.vue"));
