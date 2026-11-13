import { newId } from "../../../common/utilities/new-id.ts";
import { computed, reactive } from "vue";
import {
  fetchProviderBalance,
  fetchProviderBalances,
  fetchProviderModels,
  fetchProviders,
  fetchProviderUsage,
  saveProviders,
  setActiveProvider,
} from "../api/client.ts";
import { BUILTIN_PROVIDER_KINDS, providerPreset, PROVIDER_PRESETS } from "./presets.ts";
import type {
  ModelPrice,
  OpenAIProviderPublic,
  ProviderBalance,
  ProviderKind,
  ProviderKindInfo,
  ProviderUsage,
} from "./types.ts";

const state = reactive({
  providers: [] as OpenAIProviderPublic[],
  activeProviderId: null as string | null,
  /** Provider kinds contributed by enabled balance plugins. */
  balanceKinds: [] as ProviderKindInfo[],
  usageKinds: [] as ProviderKindInfo[],
  keyDrafts: {} as Record<string, string>,
  balances: {} as Record<string, ProviderBalance | undefined>,
  usage: {} as Record<string, ProviderUsage | undefined>,
  usageBusy: {} as Record<string, boolean | undefined>,
  /** Ids the provider offers upstream, per provider; not saved, only offered for registering. */
  remoteModels: {} as Record<string, string[] | undefined>,
  fetchingModels: {} as Record<string, boolean | undefined>,
  modelsError: {} as Record<string, string | undefined>,
  /** Bumped when providers or keys are applied from the server; balance views refetch on it. */
  revision: 0,
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
  const balanceKinds = computed(() => state.balanceKinds);
  const kindOptions = computed<ProviderKindInfo[]>(() => [
    ...BUILTIN_PROVIDER_KINDS.map((kind) => ({
      kind,
      title: PROVIDER_PRESETS[kind].label,
      ...(PROVIDER_PRESETS[kind].hint ? { description: PROVIDER_PRESETS[kind].hint } : {}),
      ...(PROVIDER_PRESETS[kind].url ? { url: PROVIDER_PRESETS[kind].url } : {}),
      ...(PROVIDER_PRESETS[kind].model ? { model: PROVIDER_PRESETS[kind].model } : {}),
    })),
    ...state.balanceKinds,
  ]);
  const kindInfoOf = (kind: string): ProviderKindInfo | undefined =>
    kindOptions.value.find((item) => item.kind === kind);
  const presetFor = (kind: string) => providerPreset(kind, kindInfoOf(kind));
  const hasBalance = (kind: string): boolean =>
    kind === "deepseek" || state.balanceKinds.some((item) => item.kind === kind);
  const hasUsage = (kind: string): boolean => state.usageKinds.some((item) => item.kind === kind);

  function apply(payload: {
    activeProviderId: string | null;
    providers: OpenAIProviderPublic[];
    balanceKinds?: ProviderKindInfo[];
    usageKinds?: ProviderKindInfo[];
  }) {
    state.providers = payload.providers;
    state.activeProviderId = payload.activeProviderId;
    state.balanceKinds = payload.balanceKinds ?? [];
    state.usageKinds = payload.usageKinds ?? [];
    state.keyDrafts = {};
    state.revision++;
  }

  async function loadBalance(id: string): Promise<void> {
    try {
      state.balances[id] = await fetchProviderBalance(id);
    } catch {
      state.balances[id] = undefined;
    }
  }

  /** One request for every enabled wallet; the server skips kinds without a balance reader. */
  async function loadBalances(): Promise<void> {
    try {
      const { wallets } = await fetchProviderBalances();
      const next: Record<string, ProviderBalance> = {};
      for (const wallet of wallets) if (wallet.providerId) next[wallet.providerId] = wallet;
      state.balances = next;
    } catch {
      // A balance outage must not erase the balances the settings already show.
    }
  }

  /** Расход провайдера зависит от внешнего читателя, поэтому запрос явный и с индикатором. */
  async function loadUsage(id: string): Promise<void> {
    if (state.usageBusy[id]) return;
    state.usageBusy[id] = true;
    try {
      state.usage[id] = await fetchProviderUsage(id);
    } catch (error) {
      state.usage[id] = {
        status: "unavailable",
        period: null,
        currency: null,
        spend: null,
        quotas: [],
        plan: null,
        credits: null,
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : "Не удалось прочитать расход",
      };
    } finally {
      state.usageBusy[id] = false;
    }
  }

  async function load(): Promise<void> {
    state.loading = true;
    state.error = "";
    try {
      apply(await fetchProviders());
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось загрузить провайдеров";
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

  function addProvider(kind: ProviderKind = "custom"): string {
    const id = `p${newId().slice(0, 8)}`;
    const preset = presetFor(kind);
    state.providers.push({
      id,
      kind,
      thinkingStyle: preset.thinking,
      name: kind === "custom" ? `Провайдер ${state.providers.length + 1}` : preset.name,
      url: preset.url,
      enabled: true,
      models: preset.model ? [{ id: preset.model, alias: preset.model }] : [],
      hasApiKey: false,
    });
    if (!state.activeProviderId) state.activeProviderId = id;
    return id;
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

  async function fetchModels(id: string): Promise<void> {
    const item = state.providers.find((row) => row.id === id);
    if (!item) return;
    state.fetchingModels[id] = true;
    state.modelsError[id] = undefined;
    try {
      state.remoteModels[id] = await fetchProviderModels({
        id,
        url: item.url,
        apiKey: state.keyDrafts[id],
      });
    } catch (err) {
      state.modelsError[id] = err instanceof Error ? err.message : "Не удалось получить список";
    } finally {
      state.fetchingModels[id] = false;
    }
  }

  /** Registers an upstream model under a name; the name stays unique within the provider. */
  function registerModel(providerId: string, id: string, alias = ""): void {
    const item = state.providers.find((row) => row.id === providerId);
    const modelId = id.trim();
    if (!item || !modelId) return;
    const taken = new Set(item.models.map((row) => row.alias));
    let name = alias.trim() || modelId;
    for (let n = 2; taken.has(name); n++) name = `${alias.trim() || modelId}-${n}`;
    item.models.push({ id: modelId, alias: name });
  }

  function unregisterModel(providerId: string, id: string): void {
    const item = state.providers.find((row) => row.id === providerId);
    if (item) item.models = item.models.filter((row) => row.id !== id);
  }

  function renameModel(providerId: string, id: string, alias: string): void {
    const row = state.providers.find((p) => p.id === providerId)?.models.find((m) => m.id === id);
    if (row) row.alias = alias;
  }

  function setModelContext(providerId: string, id: string, tokens: number | undefined): void {
    const row = state.providers.find((p) => p.id === providerId)?.models.find((m) => m.id === id);
    if (row) row.contextTokens = tokens;
  }

  /** One figure of the price; the server keeps the price only once input and output are both set. */
  function setModelPrice(
    providerId: string,
    id: string,
    field: keyof ModelPrice,
    value: number | undefined,
  ): void {
    const row = state.providers.find((p) => p.id === providerId)?.models.find((m) => m.id === id);
    if (row) row.price = { ...row.price, [field]: value };
  }

  function setModelThinking(providerId: string, id: string, can: boolean): void {
    const row = state.providers.find((p) => p.id === providerId)?.models.find((m) => m.id === id);
    if (row) row.thinking = can ? undefined : false;
  }

  return {
    fetchModels,
    setModelThinking,
    setModelContext,
    setModelPrice,
    registerModel,
    unregisterModel,
    renameModel,
    remoteModels: computed(() => state.remoteModels),
    fetchingModels: computed(() => state.fetchingModels),
    modelsError: computed(() => state.modelsError),
    providers,
    activeProviderId,
    activeProvider,
    loading,
    saving,
    error,
    ready,
    balanceKinds,
    usageKinds: computed(() => state.usageKinds),
    kindOptions,
    kindInfoOf,
    presetFor,
    hasBalance,
    hasUsage,
    revision: computed(() => state.revision),
    balances: computed(() => state.balances),
    usage: computed(() => state.usage),
    usageBusy: computed(() => state.usageBusy),
    loadBalance,
    loadBalances,
    loadUsage,
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
