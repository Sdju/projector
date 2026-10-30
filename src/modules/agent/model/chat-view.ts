import { computed } from "vue";
import type { ChatState } from "./chat-state.ts";

/** The state as the chat view reads it: only what the template and the controller need. */
export function useChatView(state: ChatState) {
  return {
    draftParts: computed({
      get: () => state.draftParts,
      set: (value) => {
        state.draftParts = value;
      },
    }),
    draft: computed({
      get: () => state.draft,
      set: (value) => {
        state.draft = value;
      },
    }),
    busy: computed(() => state.busy),
    loading: computed(() => state.loading),
    error: computed({
      get: () => state.error,
      set: (value) => {
        state.error = value;
      },
    }),
    phase: computed(() => state.phase),
    permissions: computed(() => state.permissions),
    questions: computed(() => state.questions),
    secrets: computed(() => state.secrets),
  };
}
