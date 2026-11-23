<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiFormGrid from "../../../common/ui/UiFormGrid.vue";
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";

import UiHint from "../../../common/ui/UiHint.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import { computed, onMounted, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { providerKindExtra } from "../model/kind-extra.ts";
import { useProviders } from "../model/store.ts";
import { THINKING_STYLES } from "../model/presets.ts";
import { combineBalances, formatAmount, formatBalance } from "../model/format-balance.ts";
import {
  formatContextWindow,
  formatProviderModelPrice,
  providerModelCapabilityTitle,
  providerModelKindOf,
  providerModelKindTitle,
  providerModelModalityTitle,
} from "@ai-projector/core/modules/providers/index.ts";
import type {
  ModelPrice,
  ProviderKind,
  ProviderModelCapability,
  ProviderModelInfo,
  ProviderModelKind,
  ProviderModelModality,
  ThinkingStyle,
} from "../model/types.ts";

/** The provider whose page the navigation opened. Without one, the section is the overview. */
const props = defineProps<{ providerId?: string }>();
/** Opening a provider goes through the navigation, so the page and its entry stay in step. */
const emit = defineEmits<{ open: [id: string | undefined] }>();

const {
  providers,
  activeProviderId,
  error,
  saving,
  keyDrafts,
  balanceKeyDrafts,
  save,
  setActive,
  addProvider,
  removeProvider,
  setKeyDraft,
  setBalanceKeyDraft,
  patchProvider,
  balances,
  usage,
  usageBusy,
  hasUsage: kindHasUsage,
  loadBalance,
  loadBalances,
  loadUsage,
  fetchModels,
  registerModel,
  unregisterModel,
  renameModel,
  setModelContext,
  setModelPrice,
  setModelThinking,
  applyCatalogMetadata,
  modelInfo,
  remoteModels,
  fetchingModels,
  modelsError,
  kindOptions,
  presetFor,
  hasBalance: kindHasBalance,
} = useProviders();
const selected = computed(() => providers.value.find((item) => item.id === props.providerId));
const enabledCount = computed(() => providers.value.filter((item) => item.enabled).length);
const modelCount = computed(() =>
  providers.value.reduce((sum, item) => sum + (item.enabled ? item.models.length : 0), 0),
);

const preset = computed(() => presetFor(selected.value?.kind ?? "custom"));
const extra = computed(() => providerKindExtra(selected.value?.kind));
// A provider saved with a plugin kind stays editable after the plugin is disabled.
const shownKinds = computed(() => {
  const list = [...kindOptions.value];
  const kind = selected.value?.kind;
  if (kind && !list.some((item) => item.kind === kind))
    list.push({ kind, title: `${kind} · плагин выключен` });
  return list;
});
const balance = computed(() => (selected.value ? balances.value[selected.value.id] : undefined));
const hasBalance = computed(() => (selected.value ? kindHasBalance(selected.value.kind) : false));
const providerUsage = computed(() => (selected.value ? usage.value[selected.value.id] : undefined));
const providerUsageBusy = computed(() =>
  Boolean(selected.value && usageBusy.value[selected.value.id]),
);
const hasUsage = computed(() => (selected.value ? kindHasUsage(selected.value.kind) : false));
const walletRows = computed(() =>
  providers.value.flatMap((provider) => {
    const value = balances.value[provider.id];
    return value?.status === "ready" ? [{ provider, value }] : [];
  }),
);
const combined = computed(() => combineBalances(walletRows.value.map((row) => row.value)));
onMounted(() => void loadBalances());

const PRICE_FIELDS = [
  ["input", "вход"],
  ["output", "выход"],
  ["cacheRead", "из кэша"],
] as const;

interface ModelRow {
  id: string;
  alias: string;
  contextTokens?: number;
  price?: ModelPrice;
  thinking?: boolean;
  on: boolean;
  /** What the provider catalog says about this id; absent for unknown custom models. */
  info?: ProviderModelInfo;
  /** The same in the shape the list renders: kind, modalities, window, tariff, abilities. */
  facts?: ModelFacts;
}

/** Pictograms for the facts line; the text lives in the tooltip and the accessible name. */
const CAPABILITY_ICONS: Record<ProviderModelCapability, string> = {
  tools: "wrench",
  reasoning: "brain",
  json: "braces",
  vision: "eye",
  "audio-input": "audio-lines",
  "video-input": "video",
};
const MODALITY_ICONS: Record<ProviderModelModality, string> = {
  text: "type",
  image: "image",
  audio: "audio-lines",
  video: "video",
  vector: "binary",
};
const KIND_ICONS: Record<ProviderModelKind, string> = {
  chat: "message-square",
  image: "image",
  speech: "volume-2",
  transcription: "mic",
  video: "video",
  embedding: "boxes",
  rerank: "list-ordered",
  other: "circle-help",
};
const capabilityIcon = (item: ProviderModelCapability) => CAPABILITY_ICONS[item];
const CAPABILITY_LEGEND = Object.keys(CAPABILITY_ICONS) as ProviderModelCapability[];
const modalityIcon = (item: ProviderModelModality) => MODALITY_ICONS[item];
const kindIcon = (item: ProviderModelKind) => KIND_ICONS[item];

interface ModelFacts {
  kind: ProviderModelKind;
  input: ProviderModelModality[];
  output: ProviderModelModality[];
  context?: string;
  price?: string;
  priceNote?: string;
  capabilities: ProviderModelCapability[];
}

/** Everything the list shows about a model, ready for pictograms and one compact line. */
function modelFacts(info: ProviderModelInfo | undefined): ModelFacts | undefined {
  if (!info) return undefined;
  return {
    kind: providerModelKindOf(info),
    input: info.input ?? [],
    output: info.output ?? [],
    ...(info.contextTokens ? { context: formatContextWindow(info.contextTokens) } : {}),
    ...(info.price
      ? { price: formatProviderModelPrice(info.price, info.currency) }
      : info.priceNote
        ? { priceNote: info.priceNote }
        : {}),
    capabilities: info.capabilities ?? [],
  };
}

/** A tooltip for the input and output of a model: «вход: текст + изображение». */
function modalityTitle(side: "вход" | "выход", item: ProviderModelModality): string {
  return `${side}: ${providerModelModalityTitle(item)}`;
}

/** Chat models first: media and embeddings are visible but do not drown the list. */
const KIND_ORDER = {
  chat: 0,
  image: 1,
  transcription: 2,
  speech: 3,
  video: 4,
  embedding: 5,
  rerank: 6,
  other: 7,
} as const;
function kindRank(info: ProviderModelInfo | undefined): number {
  return info ? KIND_ORDER[providerModelKindOf(info)] : KIND_ORDER.other;
}

/** Fills the editable fields from the catalog again after a manual change. */
function applyCatalog(id: string): void {
  if (selected.value) applyCatalogMetadata(selected.value.id, id);
}
const filter = ref("");
const chatOnly = ref(false);
// Registered models first, then the rest of what the provider offers upstream.
const rows = computed<ModelRow[]>(() => {
  const item = selected.value;
  if (!item) return [];
  const registered = item.models.map((row) => ({
    ...row,
    on: true,
    info: modelInfo(item.id, row.id),
    facts: modelFacts(modelInfo(item.id, row.id)),
  }));
  const known = new Set(item.models.map((row) => row.id));
  const rest = (remoteModels.value[item.id] ?? [])
    .filter((id) => !known.has(id))
    .map((id) => {
      const info = modelInfo(item.id, id);
      return { id, alias: id, on: false, info, facts: modelFacts(info) };
    });
  const needle = filter.value.trim().toLowerCase();
  return [...registered, ...rest]
    .filter((row) => !chatOnly.value || !row.info || providerModelKindOf(row.info) === "chat")
    .filter(
      (row) =>
        !needle ||
        row.id.toLowerCase().includes(needle) ||
        row.alias.toLowerCase().includes(needle) ||
        row.info?.description?.toLowerCase().includes(needle) ||
        row.info?.capabilities?.some((item) => providerModelCapabilityTitle(item).includes(needle)),
    )
    .sort((left, right) => kindRank(left.info) - kindRank(right.info));
});
const fetching = computed(() => Boolean(selected.value && fetchingModels.value[selected.value.id]));
const duplicates = computed(() => {
  const seen = new Set<string>();
  return (selected.value?.models ?? []).some((row) => {
    const name = row.alias.trim() || row.id;
    return seen.size === seen.add(name).size;
  });
});
const offered = computed(() => {
  const item = selected.value;
  if (!item) return 0;
  const known = new Set(item.models.map((row) => row.id));
  return (
    item.models.length + (remoteModels.value[item.id] ?? []).filter((id) => !known.has(id)).length
  );
});
/** Registered models that cannot answer in chat: the list must say so instead of hiding it. */
const nonChatRegistered = computed(() =>
  (selected.value?.models ?? []).filter((row) => {
    const info = modelInfo(selected.value!.id, row.id);
    return info ? providerModelKindOf(info) !== "chat" : false;
  }),
);
const manual = ref("");

function setPrice(id: string, field: keyof ModelPrice, value: string): void {
  if (!selected.value) return;
  const number = value.trim() === "" ? undefined : Number(value);
  setModelPrice(selected.value.id, id, field, Number.isFinite(number) ? number : undefined);
}

function setContext(id: string, value: string): void {
  if (selected.value) setModelContext(selected.value.id, id, Number(value) || undefined);
}

/** A new type brings the thinking dialect that suits it; the user can pick another afterwards. */
function changeKind(kind: ProviderKind): void {
  if (selected.value)
    patchProvider(selected.value.id, { kind, thinkingStyle: presetFor(kind).thinking });
}

function toggle(row: ModelRow, on: boolean): void {
  if (!selected.value) return;
  if (on) registerModel(selected.value.id, row.id);
  else unregisterModel(selected.value.id, row.id);
}

function addManual(): void {
  if (selected.value) registerModel(selected.value.id, manual.value);
  manual.value = "";
}

function add(kind: ProviderKind): string {
  const id = addProvider(kind);
  emit("open", id);
  return id;
}

function remove(id: string): void {
  removeProvider(id);
  emit("open", undefined);
}

const commands = useCommandScope("provider-settings", () => ({
  surface: "settings",
  provider: props.providerId ?? null,
}));
commands.scope.registerCommand({
  id: "ide.providers.add",
  title: "Добавить провайдера",
  description:
    "Добавляет провайдера из пресета выбранного вида: встроенного или объявленного включённым плагином. Подставляет имя, адрес и модель; ключ вводится в форме, затем «сохранить».",
  arguments: { kind: "вид провайдера из списка доступных" },
  run: (value) => {
    const raw = commandArgs(value).kind;
    const kind = typeof raw === "string" ? raw : "custom";
    if (!kindOptions.value.some((item) => item.kind === kind))
      throw new Error("Неизвестный тип провайдера");
    return add(kind);
  },
});
commands.scope.registerCommand({
  id: "ide.providers.models.refresh",
  title: "Загрузить список моделей провайдера",
  description:
    "Запрашивает у выбранного провайдера список моделей (GET /models по схеме OpenAI) и показывает их в карточке вместе с паспортом: окно контекста, тариф, возможности и описание. Модели регистрируются командой ide.providers.models.register.",
  enabled: () => Boolean(selected.value?.url),
  run: async () => {
    if (selected.value) await fetchModels(selected.value.id);
  },
});
commands.scope.registerCommand({
  id: "ide.providers.models.register",
  title: "Зарегистрировать модель провайдера",
  description:
    "Добавляет модель выбранного провайдера: model — id у провайдера, alias — имя, под которым её увидят агент и шлюз (по умолчанию тот же id). Если модель есть в паспорте провайдера, окно контекста и цена за 1 млн токенов заполняются сразу. Затем «сохранить».",
  arguments: { model: "id модели у провайдера", alias: "имя (необязательно)" },
  enabled: () => Boolean(selected.value),
  run: (value) => {
    const { model, alias } = commandArgs(value);
    if (!selected.value || typeof model !== "string" || !model.trim())
      throw new Error("Укажите model");
    registerModel(selected.value.id, model, typeof alias === "string" ? alias : "");
  },
});
commands.scope.registerCommand({
  id: "ide.providers.enabled.set",
  title: "Включить или выключить провайдера",
  description:
    "Включённый провайдер предлагает свои зарегистрированные модели агенту и шлюзу; включённых может быть сколько угодно. enabled: true | false. Затем «сохранить».",
  arguments: { enabled: "true | false" },
  enabled: () => Boolean(selected.value),
  run: (value) => {
    if (selected.value)
      patchProvider(selected.value.id, { enabled: String(commandArgs(value).enabled) !== "false" });
  },
});
commands.scope.registerCommand({
  id: "ide.providers.balance.refresh",
  title: "Обновить баланс провайдера",
  description:
    "Запрашивает баланс выбранного провайдера: DeepSeek, OpenRouter и виды, для которых включённый плагин зарегистрировал читатель.",
  enabled: () => hasBalance.value,
  run: async () => {
    if (selected.value) await loadBalance(selected.value.id);
  },
});
commands.scope.registerCommand({
  id: "ide.providers.usage.refresh",
  title: "Проверить расход провайдера",
  description:
    "Запрашивает расход и квоты выбранного провайдера, если для его вида зарегистрирован читатель. Это не остаток кошелька: читатель возвращает только то, что отдаёт провайдер.",
  enabled: () => hasUsage.value && !providerUsageBusy.value,
  run: async () => {
    if (selected.value) await loadUsage(selected.value.id);
  },
});

function keyDraft(): string {
  if (!selected.value) return "";
  return keyDrafts.value[selected.value.id] ?? "";
}

function balanceKeyDraft(): string {
  if (!selected.value) return "";
  return balanceKeyDrafts.value[selected.value.id] ?? "";
}
</script>

<template>
  <UiStack as="section" :gap="4">
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <template v-if="!selected">
      <UiHint>
        Провайдеры OpenAI-compatible API перечислены слева: у каждого своя страница. Включённых
        может быть сколько угодно, агент выбирает любую их модель.
      </UiHint>
      <UiStack v-if="walletRows.length" class="wallets" :gap="1">
        <UiInline wrap justify="between">
          <span class="kicker">все кошельки</span>
          <strong>{{ formatBalance(combined) }}</strong>
        </UiInline>
        <UiInline v-for="row in walletRows" :key="row.provider.id" wrap :gap="2">
          <span>{{ row.provider.name }}</span>
          <span class="wallet-balance">{{ formatBalance(row.value.entries) }}</span>
          <span v-if="!row.provider.enabled" class="wallet-off">выключен</span>
        </UiInline>
      </UiStack>
      <UiInline wrap :gap="2">
        <UiButton
          v-for="info in kindOptions"
          :key="info.kind"
          :title="info.title"
          @click="commands.run('ide.providers.add', { kind: info.kind })"
        >
          + {{ info.kind === "custom" ? "другой" : info.title.split(" ")[0] }}
        </UiButton>
      </UiInline>
      <UiHint v-if="providers.length">
        Включено {{ enabledCount }} из {{ providers.length }} · моделей {{ modelCount }}
      </UiHint>
      <UiHint v-else>Провайдеров нет: добавьте первого кнопкой выше.</UiHint>
    </template>

    <UiStack v-else class="form" :gap="3">
      <UiFormGrid layout="wide-end">
        <UiField v-slot="{ control }" label="имя">
          <UiControl
            v-bind="control"
            aria-label="Имя провайдера"
            :value="selected.name"
            @input="patchProvider(selected.id, { name: ($event.target as HTMLInputElement).value })"
          />
        </UiField>
        <UiField v-slot="{ control }" label="тип">
          <UiControl
            as="select"
            v-bind="control"
            aria-label="Тип провайдера"
            :value="selected.kind"
            @change="changeKind(($event.target as HTMLSelectElement).value as ProviderKind)"
          >
            <option v-for="info in shownKinds" :key="info.kind" :value="info.kind">
              {{ info.title }}
            </option>
          </UiControl>
        </UiField>
      </UiFormGrid>
      <UiField v-slot="{ control }" label="размышление">
        <UiControl
          as="select"
          v-bind="control"
          aria-label="Способ включать размышление модели"
          :value="selected.thinkingStyle"
          @change="
            patchProvider(selected.id, {
              thinkingStyle: ($event.target as HTMLSelectElement).value as ThinkingStyle,
            })
          "
        >
          <option v-for="item in THINKING_STYLES" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </UiControl>
      </UiField>
      <UiField v-slot="{ control }" label="запасная модель">
        <UiControl
          as="select"
          v-bind="control"
          aria-label="Запасная модель при сбоях провайдера"
          :value="selected.fallbackModel ?? ''"
          @change="
            patchProvider(selected.id, {
              fallbackModel: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="">Нет</option>
          <option v-for="model in selected.models" :key="model.id" :value="model.alias">
            {{ model.alias }}
          </option>
        </UiControl>
      </UiField>
      <UiFormGrid layout="wide-end">
        <UiField v-slot="{ control }" label="url">
          <UiControl
            v-bind="control"
            aria-label="URL API"
            :value="selected.url"
            spellcheck="false"
            :placeholder="preset.urlPlaceholder || preset.url || 'https://…'"
            @input="patchProvider(selected.id, { url: ($event.target as HTMLInputElement).value })"
          />
        </UiField>
        <UiField v-slot="{ control }" label="api key">
          <UiControl
            v-bind="control"
            aria-label="API key"
            :value="keyDraft()"
            type="password"
            autocomplete="off"
            :placeholder="selected.hasApiKey ? 'сохранён — введите новый' : preset.keyPlaceholder"
            @input="setKeyDraft(selected.id, ($event.target as HTMLInputElement).value)"
          />
        </UiField>
        <UiField v-if="selected.kind === 'openrouter'" v-slot="{ control }" label="management key">
          <UiControl
            v-bind="control"
            aria-label="OpenRouter management key"
            :value="balanceKeyDraft()"
            type="password"
            autocomplete="off"
            :placeholder="
              selected.hasBalanceApiKey ? 'сохранён — введите новый' : 'для просмотра баланса'
            "
            @input="setBalanceKeyDraft(selected.id, ($event.target as HTMLInputElement).value)"
          />
        </UiField>
      </UiFormGrid>
      <UiHint>{{ preset.hint }}</UiHint>
      <component :is="extra.component" v-if="extra" :provider="selected" />

      <UiStack class="models" :gap="2">
        <UiInline wrap justify="between">
          <span class="kicker">
            модели · {{ selected.models.length }}
            <template v-if="remoteModels[selected.id]"> из {{ offered }}</template>
          </span>
          <UiButton
            appearance="outline"
            tone="muted"
            shape="chip"
            :disabled="fetching || !selected.url"
            @click="commands.run('ide.providers.models.refresh')"
          >
            {{ fetching ? "загрузка…" : "загрузить список" }}
          </UiButton>
        </UiInline>
        <UiMessage v-if="modelsError[selected.id]" tone="danger" size="xs" flush role="alert">
          {{ modelsError[selected.id] }}
        </UiMessage>
        <UiMessage v-if="duplicates" tone="danger" size="xs" flush>
          Имена моделей должны различаться: повторное имя при сохранении отбросится.
        </UiMessage>
        <UiMessage v-if="nonChatRegistered.length" tone="warning" size="xs" flush>
          В чате не работают: {{ nonChatRegistered.map((row) => row.alias).join(", ") }}. Это модели
          изображений, речи, видео или эмбеддингов — им место во вкладке «Медиа».
        </UiMessage>
        <UiInline v-if="rows.length > 8 || filter" wrap :gap="3">
          <UiControl
            v-model="filter"
            grow
            aria-label="Фильтр моделей"
            placeholder="фильтр"
            spellcheck="false"
          />
          <label class="chat-only">
            <UiControl v-model="chatOnly" type="checkbox" />
            только для чата
          </label>
        </UiInline>
        <UiScrollArea v-if="rows.length" class="list">
          <div v-for="row in rows" :key="row.id" class="model-entry">
            <label class="row" :class="{ off: !row.on }">
              <UiControl
                type="checkbox"
                :aria-label="`Зарегистрировать ${row.id}`"
                :model-value="row.on"
                @update:model-value="toggle(row, Boolean($event))"
              />
              <span class="mid" :title="row.info?.description">{{ row.id }}</span>
              <UiControl
                v-if="row.on"
                class="alias"
                mono
                :aria-label="`Имя модели ${row.id}`"
                :value="row.alias"
                :placeholder="row.id"
                spellcheck="false"
                @input="renameModel(selected.id, row.id, ($event.target as HTMLInputElement).value)"
              />
              <UiControl
                v-if="row.on"
                class="ctx"
                mono
                type="number"
                min="1000"
                step="1000"
                :aria-label="`Окно контекста ${row.id}, токенов`"
                :value="row.contextTokens"
                placeholder="окно, токенов"
                @input="setContext(row.id, ($event.target as HTMLInputElement).value)"
              />
              <UiControl
                v-if="row.on"
                class="think"
                type="checkbox"
                title="Модель умеет размышлять: над строкой ввода агента появится переключатель"
                :aria-label="`Размышление ${row.id}`"
                :model-value="row.thinking !== false"
                @update:model-value="setModelThinking(selected.id, row.id, Boolean($event))"
              />
              <span v-if="row.on" class="price">
                <span v-for="[field, label] in PRICE_FIELDS" :key="field" class="price-field">
                  <span class="price-label">{{ label }}</span>
                  <UiControl
                    mono
                    type="number"
                    min="0"
                    step="any"
                    :aria-label="`Цена ${label} ${row.id}, за 1 млн токенов`"
                    :value="row.price?.[field]"
                    placeholder="—"
                    @input="setPrice(row.id, field, ($event.target as HTMLInputElement).value)"
                  />
                </span>
              </span>
              <UiInline v-if="row.facts" class="model-facts" wrap :gap="2">
                <span
                  v-if="row.facts.kind !== 'chat'"
                  class="model-kind"
                  :title="providerModelKindTitle(row.facts.kind)"
                  :aria-label="providerModelKindTitle(row.facts.kind)"
                  role="img"
                >
                  <ProjectorIcon :name="kindIcon(row.facts.kind)" />
                  {{ providerModelKindTitle(row.facts.kind) }}
                </span>
                <span v-if="row.facts.input.length || row.facts.output.length" class="model-flow">
                  <span
                    v-for="item in row.facts.input"
                    :key="`in-${item}`"
                    class="fact-icon"
                    :title="modalityTitle('вход', item)"
                    :aria-label="modalityTitle('вход', item)"
                    role="img"
                  >
                    <ProjectorIcon :name="modalityIcon(item)" />
                  </span>
                  <ProjectorIcon
                    v-if="row.facts.input.length && row.facts.output.length"
                    name="arrow-right"
                    class="flow-arrow"
                    aria-hidden="true"
                  />
                  <span
                    v-for="item in row.facts.output"
                    :key="`out-${item}`"
                    class="fact-icon"
                    :title="modalityTitle('выход', item)"
                    :aria-label="modalityTitle('выход', item)"
                    role="img"
                  >
                    <ProjectorIcon :name="modalityIcon(item)" />
                  </span>
                </span>
                <span v-if="row.facts.context" class="fact-text">{{ row.facts.context }}</span>
                <span v-if="row.facts.price" class="fact-text">{{ row.facts.price }}</span>
                <span v-if="row.facts.priceNote" class="fact-text fact-note">{{
                  row.facts.priceNote
                }}</span>
                <span
                  v-for="item in row.facts.capabilities"
                  :key="item"
                  class="fact-icon"
                  :title="providerModelCapabilityTitle(item)"
                  :aria-label="providerModelCapabilityTitle(item)"
                  role="img"
                >
                  <ProjectorIcon :name="capabilityIcon(item)" />
                </span>
              </UiInline>
            </label>
            <div
              v-if="row.on && row.info && (row.info.description || row.info.priceNote)"
              class="catalog"
            >
              <p class="catalog-shape">
                <span class="catalog-kind">
                  <ProjectorIcon
                    :name="kindIcon(providerModelKindOf(row.info))"
                    aria-hidden="true"
                  />
                  {{ providerModelKindTitle(providerModelKindOf(row.info)) }}
                </span>
                <span
                  v-for="item in row.info.input ?? []"
                  :key="`cin-${item}`"
                  class="fact-icon"
                  :title="modalityTitle('вход', item)"
                  :aria-label="modalityTitle('вход', item)"
                  role="img"
                >
                  <ProjectorIcon :name="modalityIcon(item)" />
                </span>
                <ProjectorIcon
                  v-if="(row.info.input ?? []).length && (row.info.output ?? []).length"
                  name="arrow-right"
                  class="flow-arrow"
                  aria-hidden="true"
                />
                <span
                  v-for="item in row.info.output ?? []"
                  :key="`cout-${item}`"
                  class="fact-icon"
                  :title="modalityTitle('выход', item)"
                  :aria-label="modalityTitle('выход', item)"
                  role="img"
                >
                  <ProjectorIcon :name="modalityIcon(item)" />
                </span>
              </p>
              <p v-if="row.info.description" class="catalog-description">
                {{ row.info.description }}
              </p>
              <p v-if="row.info.priceNote" class="catalog-note">{{ row.info.priceNote }}</p>
              <p v-if="row.info.source" class="catalog-source">
                <a :href="row.info.source" target="_blank" rel="noreferrer">каталог провайдера</a>
                <template v-if="row.info.checkedAt"> · проверено {{ row.info.checkedAt }}</template>
                <template v-if="row.info.deprecated"> · модель устарела</template>
                <template v-if="row.on && (row.info.price || row.info.contextTokens)">
                  ·
                  <button type="button" class="catalog-fill" @click="applyCatalog(row.id)">
                    заполнить поля
                  </button>
                </template>
              </p>
            </div>
          </div>
        </UiScrollArea>
        <UiHint v-else-if="!selected.models.length">
          Моделей нет: загрузите список у провайдера или добавьте id вручную.
        </UiHint>
        <UiInline :gap="2">
          <UiControl
            v-model="manual"
            grow
            aria-label="Id модели"
            placeholder="добавить id вручную"
            spellcheck="false"
            @keydown.enter.prevent="addManual"
          />
          <UiButton :disabled="!manual.trim()" @click="addManual">+</UiButton>
        </UiInline>
        <UiInline v-if="selected.models.length" class="model-legend" wrap :gap="2">
          <span class="legend-label">возможности:</span>
          <span v-for="item in CAPABILITY_LEGEND" :key="item" class="legend-item">
            <span class="fact-icon fact-cap">
              <ProjectorIcon :name="capabilityIcon(item)" aria-hidden="true" />
            </span>
            {{ providerModelCapabilityTitle(item) }}
          </span>
        </UiInline>
        <UiHint>
          Имя — под которым модель видна агенту и шлюзу; по умолчанию совпадает с id. Окно контекста
          нужно кольцу заполнения в чате агента; без него берётся 128000. Цена — за 1 млн токенов в
          валюте тарифа (вход и выход обязательны, «из кэша» по умолчанию равна входу): с ней под
          ответом агента видна его стоимость и стоимость всего чата.
        </UiHint>
      </UiStack>

      <UiStack v-if="hasBalance" class="balance" :gap="1">
        <UiInline wrap justify="between">
          <span class="kicker">баланс</span>
          <UiButton
            appearance="outline"
            tone="muted"
            shape="chip"
            @click="commands.run('ide.providers.balance.refresh')"
          >
            обновить
          </UiButton>
        </UiInline>
        <template v-if="balance?.status === 'ready'">
          <UiInline v-for="entry in balance.entries" :key="entry.currency" wrap :gap="3">
            <strong>{{ formatAmount(entry.currency, entry.total) }}</strong>
            <span class="meta">
              пополнено {{ formatAmount(entry.currency, entry.toppedUp) }} · подарочные
              {{ formatAmount(entry.currency, entry.granted) }}
            </span>
          </UiInline>
          <UiMessage v-if="balance.available === false" tone="danger" size="xs" flush>
            Провайдер сообщает, что средств для вызовов недостаточно.
          </UiMessage>
        </template>
        <UiLoader
          v-else-if="!balance?.message && (selected.hasApiKey || selected.hasBalanceApiKey)"
          size="sm"
          >загрузка…</UiLoader
        >
        <UiHint v-else>{{ balance?.message ?? "Сохраните ключ, чтобы увидеть баланс." }}</UiHint>
      </UiStack>
      <UiStack v-if="hasUsage" class="balance" :gap="1">
        <UiInline wrap justify="between">
          <span class="kicker">расход провайдера</span>
          <UiButton
            appearance="outline"
            tone="muted"
            shape="chip"
            :disabled="providerUsageBusy"
            @click="commands.run('ide.providers.usage.refresh')"
          >
            проверить
          </UiButton>
        </UiInline>
        <template v-if="providerUsage?.status === 'ready'">
          <UiInline wrap :gap="3">
            <strong>{{
              providerUsage.spend ? `${providerUsage.currency ?? ""} ${providerUsage.spend}` : "—"
            }}</strong>
            <span v-if="providerUsage.period" class="meta">
              {{ providerUsage.period.from }} → {{ providerUsage.period.to }}
            </span>
          </UiInline>
          <UiInline v-if="providerUsage.plan" wrap :gap="2">
            <span class="meta">план</span><strong>{{ providerUsage.plan }}</strong>
            <span v-if="providerUsage.credits" class="meta">
              кредиты {{ providerUsage.credits.remaining }} / {{ providerUsage.credits.total }}
            </span>
          </UiInline>
          <UiInline
            v-for="item in providerUsage.quotas.slice(0, 4)"
            :key="item.modelId"
            wrap
            :gap="2"
          >
            <code>{{ item.modelId }}</code>
            <span class="meta">
              {{ item.remaining ?? "—" }} / {{ item.total ?? "—" }} {{ item.unit ?? "" }}
              <template v-if="item.percent !== null"> · {{ item.percent }}%</template>
            </span>
          </UiInline>
          <UiHint>
            Это расход и квоты провайдера, не остаток кошелька. Источник зависит от вида провайдера.
          </UiHint>
          <UiHint v-if="providerUsage.message">{{ providerUsage.message }}</UiHint>
        </template>
        <UiLoader v-else-if="providerUsageBusy" size="sm">читаем расход…</UiLoader>
        <UiHint v-else>
          {{ providerUsage?.message ?? "Нажмите «проверить», чтобы прочитать расход провайдера." }}
        </UiHint>
      </UiStack>
      <UiInline wrap justify="between">
        <UiInline wrap :gap="2">
          <label class="switch">
            <UiControl
              type="checkbox"
              :model-value="selected.enabled"
              @update:model-value="
                commands.run('ide.providers.enabled.set', { enabled: Boolean($event) })
              "
            />
            включён
          </label>
          <UiButton
            appearance="outline"
            tone="muted"
            shape="chip"
            title="Провайдер по умолчанию: его баланс в статусной строке и модель, если выбранной нет"
            :disabled="selected.id === activeProviderId"
            @click="setActive(selected.id)"
          >
            по умолчанию
          </UiButton>
        </UiInline>
        <UiInline wrap :gap="2">
          <UiButton tone="danger" @click="remove(selected.id)">удалить</UiButton>
          <UiButton appearance="solid" :disabled="saving" @click="save">
            {{ saving ? "…" : "сохранить" }}
          </UiButton>
        </UiInline>
      </UiInline>
    </UiStack>
  </UiStack>
</template>

<style scoped>
.kicker {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.balance {
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--line);
}

.meta {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.models {
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--line);
  container-type: inline-size;
}

.list {
  flex: none;
  max-height: 15rem;
}

.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--sp-1) var(--sp-2);
  align-items: center;
  padding: var(--sp-1) 0;
  cursor: pointer;
}

.row.off .mid {
  color: var(--muted);
}

.mid {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.alias,
.ctx,
.think {
  grid-column: 2;
}

.price {
  grid-column: 2 / -1;
  display: flex;
  gap: var(--sp-2);
}

.price-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}
.model-entry {
  display: grid;
}
.model-facts {
  grid-column: 2 / -1;
  color: var(--faint);
  font-size: var(--fs-xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.model-facts,
.catalog-shape {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.model-kind,
.catalog-kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text-2);
  font-weight: 600;
}
.model-flow {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.fact-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--text-2);
}
.fact-cap {
  width: 22px;
  height: 22px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-2);
}
.fact-icon .projector-icon,
.model-kind .projector-icon,
.catalog-kind .projector-icon {
  width: 15px;
  height: 15px;
}
.fact-cap .projector-icon {
  width: 16px;
  height: 16px;
}
.flow-arrow {
  width: 15px;
  height: 15px;
  color: var(--faint);
}
.fact-text {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.model-legend {
  align-items: center;
  color: var(--faint);
  font-size: var(--fs-xs);
}
.legend-label {
  font-weight: 600;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.fact-note {
  max-width: 100%;
}
.catalog {
  display: grid;
  gap: 2px;
  padding: 0 0 var(--sp-2) var(--sp-5);
}
.catalog-description,
.catalog-note,
.catalog-source {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.45;
}
.catalog-description {
  color: var(--muted);
}
.catalog-note,
.catalog-source {
  color: var(--faint);
}
.chat-only {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.catalog-shape {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: 1.45;
}
.catalog-source a,
.catalog-fill {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.price-label {
  color: var(--muted);
  font-size: var(--fs-xs);
}

@container (min-width: 30rem) {
  .row {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) 9rem auto;
  }
  .alias {
    grid-column: 3;
  }
  .ctx {
    grid-column: 4;
  }
  .think {
    grid-column: 5;
  }
}

.switch {
  display: inline-flex;
  gap: var(--sp-1);
  align-items: center;
  font-size: var(--fs-xs);
  cursor: pointer;
}

.wallets {
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.wallets strong,
.wallet-balance {
  font-variant-numeric: tabular-nums;
}

.wallets .kicker {
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wallet-balance {
  color: var(--text-2);
}

.wallet-off {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
