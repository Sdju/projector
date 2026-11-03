import type { InjectionKey } from "vue";

/** The project a chat answer belongs to: its images resolve against these files. */
export const chatProjectKey: InjectionKey<string> = Symbol("chat-project");
