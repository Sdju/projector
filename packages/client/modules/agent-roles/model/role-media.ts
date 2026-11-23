import { reactive, ref } from "vue";
import {
  mediaModelSelectionValue,
  type AgentRole,
} from "@ai-projector/core/modules/agent-role/index.ts";
import type { MediaModel } from "@ai-projector/core/modules/media/index.ts";
import { fetchMediaModels } from "../../media/index.ts";
import { readListenerState, type ListenerState } from "../api/roles.ts";

/**
 * Media models split by capability: a media role names one capability and picks a model only from
 * that group. The same endpoint feeds the «Медиа» tab, so a model appears in both places.
 */
const state = reactive({ models: [] as MediaModel[] });
let loading: Promise<MediaModel[]> | undefined;

/** One media model as a picker option: `providerId:model` is the stored selection value. */
export interface RoleMediaOption {
  value: string;
  providerId: string;
  providerName: string;
  model: string;
  name: string;
}

/** The models of one capability, ready for a select; the same model id may exist at two providers. */
export function mediaOptionsFor(role: Pick<AgentRole, "media">): RoleMediaOption[] {
  if (!role.media) return [];
  return state.models
    .filter((model) => model.capability === role.media?.capability)
    .map((model) => ({
      value: mediaModelSelectionValue(model.providerId, model.id),
      providerId: model.providerId,
      providerName: model.providerName,
      model: model.id,
      name: `${model.title ?? model.alias} — ${model.providerName}`,
    }));
}

/** One catalog entry by provider and model id, when the provider still lists it. */
export function mediaModelOf(providerId: string, model: string): MediaModel | undefined {
  return state.models.find((entry) => entry.providerId === providerId && entry.id === model);
}

/** Media models for roles that take a model by capability; loaded once, like chat controls. */
export async function loadRoleMediaModels(force = false): Promise<MediaModel[]> {
  if (state.models.length && !force) return state.models;
  if (loading) return loading;
  loading = fetchMediaModels()
    .then((models) => {
      state.models = Array.isArray(models) ? models : [];
      return state.models;
    })
    .catch((error) => {
      state.models = [];
      throw error;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Whether any configuration could use media models: the settings skip the request otherwise. */
export function hasMediaRole(roles: readonly Pick<AgentRole, "media">[]): boolean {
  return roles.some((role) => role.media);
}

/** The recognition model Listener resolves to; `null` while unknown or when none is available. */
export const listener = ref<ListenerState | null>(null);

export async function loadListener(): Promise<ListenerState | null> {
  try {
    listener.value = await readListenerState();
  } catch {
    listener.value = null;
  }
  return listener.value;
}
