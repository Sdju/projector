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

/** The chat's own feature choice: reactive for the island, saved with the chat when it changes. */
export function featureChoice(state: ChatState, persist: () => void) {
  return {
    featureOverrides: computed(() => state.featureOverrides),
    setFeatureOverrides(value: string[] | undefined) {
      state.featureOverrides = value;
      persist();
    },
  };
}

/** The chat's Judge override: reactive for the island, saved with the chat when it changes. */
export function judgeChoice(state: ChatState, persist: () => void) {
  return {
    judgeOverride: computed(() => state.judgeOverride),
    setJudgeOverride(value: ChatState["judgeOverride"]) {
      state.judgeOverride = value;
      persist();
    },
  };
}
