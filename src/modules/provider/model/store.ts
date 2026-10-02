import { computed, reactive } from "vue";
import { fetchProviders, saveProviders, setActiveProvider } from "../api/client.ts";
import type { OpenAIProviderPublic } from "./types.ts";

const state = reactive({
  providers: [] as OpenAIProviderPublic[],
  activeProviderId: null as string | null,
  keyDrafts: {} as Record<string, string>,
  loading: false,
  saving: false,
  error: "",
});

export function useProviders() {
  const providers = computed(() => state.providers);
  const activeProviderId = computed(() => state.activeProviderId);
  const activeProvider = computed(
    () =>
      state.providers.find((item) => item.id === state.activeProviderId) ??
      state.providers[0] ??
      null,
  );
  const loading = computed(() => state.loading);
  const saving = computed(() => state.saving);
  const error = computed(() => state.error);
  const ready = computed(() => Boolean(activeProvider.value?.url));

  function apply(payload: { activeProviderId: string | null; providers: OpenAIProviderPublic[] }) {
    state.providers = payload.providers;
    state.activeProviderId = payload.activeProviderId;
    state.keyDrafts = {};
  }

  async function load(): Promise<void> {
    state.loading = true;
    state.error = "";
    try {
      apply(await fetchProviders());
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось загрузить Qwen";
    } finally {
      state.loading = false;
    }
  }

  async function save(): Promise<void> {
    state.saving = true;
    state.error = "";
    try {
      apply(
        await saveProviders({
          activeProviderId: state.activeProviderId,
          providers: state.providers.map((item) => ({
            ...item,
            apiKey: state.keyDrafts[item.id],
          })),
        }),
      );
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось сохранить";
    } finally {
      state.saving = false;
    }
  }

  async function setActive(id: string): Promise<void> {
    state.activeProviderId = id;
    try {
      apply(await setActiveProvider(id));
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось выбрать провайдера";
    }
  }

  function addProvider(): void {
    const id = `p${crypto.randomUUID().slice(0, 8)}`;
    state.providers.push({
      id,
      name: `Провайдер ${state.providers.length + 1}`,
      url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.8-flash",
      hasApiKey: false,
    });
    if (!state.activeProviderId) state.activeProviderId = id;
  }

  function removeProvider(id: string): void {
    state.providers = state.providers.filter((item) => item.id !== id);
    delete state.keyDrafts[id];
    if (state.activeProviderId === id) {
      state.activeProviderId = state.providers[0]?.id ?? null;
    }
    void save();
  }

  function setKeyDraft(id: string, value: string): void {
    state.keyDrafts[id] = value;
  }

  function patchProvider(id: string, patch: Partial<OpenAIProviderPublic>): void {
    const item = state.providers.find((row) => row.id === id);
    if (!item) return;
    Object.assign(item, patch);
  }

  return {
    providers,
    activeProviderId,
    activeProvider,
    loading,
    saving,
    error,
    ready,
    keyDrafts: computed(() => state.keyDrafts),
    load,
    save,
    setActive,
    addProvider,
    removeProvider,
    setKeyDraft,
    patchProvider,
  };
}
