import { computed, reactive } from "vue";
import { readAgentFeatures, type AgentFeatures } from "../api/features.ts";

/**
 * The feature catalog shared by the chat island and the settings: it is the same server state, so
 * a default changed in one place is seen in the other without a reload.
 */
const state = reactive({
  data: { features: [], file: "" } as AgentFeatures,
  loaded: false,
  error: "",
});
let loading: Promise<AgentFeatures> | undefined;

export async function loadAgentFeatures(force = false): Promise<AgentFeatures> {
  if (state.loaded && !force) return state.data;
  if (loading) return loading;
  loading = readAgentFeatures()
    .then((data) => {
      state.data = data;
      state.loaded = true;
      state.error = "";
      return data;
    })
    .catch((error) => {
      state.error = error instanceof Error ? error.message : "Ошибка возможностей агентов";
      throw error;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Applies a response that already carries the whole state (a saved default). */
export function applyAgentFeatures(data: AgentFeatures): void {
  state.data = data;
  state.loaded = true;
  state.error = "";
}

export function useAgentFeatureCatalog() {
  return {
    data: computed(() => state.data),
    loaded: computed(() => state.loaded),
    error: computed(() => state.error),
    load: loadAgentFeatures,
  };
}
