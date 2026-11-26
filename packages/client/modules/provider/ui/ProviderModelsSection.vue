<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiScrollArea from "../../../common/ui/UiScrollArea.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import {
  providerModelCapabilityTitle,
  providerModelKindOf,
} from "@ai-projector/core/modules/providers/index.ts";
import type { ModelPrice, OpenAIProviderPublic } from "../model/types.ts";

import ProviderModelRow from "./ProviderModelRow.vue";
import { useProviders } from "../model/store.ts";
import {
  type ModelRow,
  capabilityIcon,
  CAPABILITY_LEGEND,
  modelFacts,
  kindRank,
} from "../model/model-facts.ts";

const props = defineProps<{ selected: OpenAIProviderPublic }>();
const emit = defineEmits<{ refresh: [] }>();
const filter = ref("");
const chatOnly = ref(false);
const manual = ref("");
watch(
  () => props.selected.id,
  () => {
    filter.value = "";
    manual.value = "";
  },
);
const {
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
} = useProviders();

/** Fills the editable fields from the catalog again after a manual change. */
function applyCatalog(id: string): void {
  applyCatalogMetadata(props.selected.id, id);
}
// Registered models first, then the rest of what the provider offers upstream.
const rows = computed<ModelRow[]>(() => {
  const item = props.selected;
  const registered = item.models.map((row) => {
    const info = modelInfo(item.id, row.id);
    return { ...row, on: true, info, facts: modelFacts(info) };
  });
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
        row.info?.capabilities?.some((cap) => providerModelCapabilityTitle(cap).includes(needle)),
    )
    .sort((left, right) => kindRank(left.info) - kindRank(right.info));
});
const fetching = computed(() => Boolean(fetchingModels.value[props.selected.id]));
const duplicates = computed(() => {
  const seen = new Set<string>();
  return props.selected.models.some((row) => {
    const name = row.alias.trim() || row.id;
    return seen.size === seen.add(name).size;
  });
});
const offered = computed(() => {
  const item = props.selected;
  const known = new Set(item.models.map((row) => row.id));
  return (
    item.models.length + (remoteModels.value[item.id] ?? []).filter((id) => !known.has(id)).length
  );
});
/** Registered models that cannot answer in chat: the list must say so instead of hiding it. */
const nonChatRegistered = computed(() =>
  props.selected.models.filter((row) => {
    const info = modelInfo(props.selected.id, row.id);
    return info ? providerModelKindOf(info) !== "chat" : false;
  }),
);

function setPrice(id: string, field: keyof ModelPrice, value: string): void {
  const number = value.trim() === "" ? undefined : Number(value);
  setModelPrice(props.selected.id, id, field, Number.isFinite(number) ? number : undefined);
}

function setContext(id: string, value: string): void {
  setModelContext(props.selected.id, id, Number(value) || undefined);
}

function toggle(row: ModelRow, on: boolean): void {
  if (on) registerModel(props.selected.id, row.id);
  else unregisterModel(props.selected.id, row.id);
}

function addManual(): void {
  registerModel(props.selected.id, manual.value);
  manual.value = "";
}
</script>

<template>
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
        @click="emit('refresh')"
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
      <ProviderModelRow
        v-for="row in rows"
        :key="row.id"
        :row="row"
        @toggle="toggle(row, $event)"
        @rename="renameModel(selected.id, row.id, $event)"
        @context="setContext(row.id, $event)"
        @thinking="setModelThinking(selected.id, row.id, $event)"
        @price="(field, value) => setPrice(row.id, field, value)"
        @apply-catalog="applyCatalog(row.id)"
      />
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
        <span class="provider-model-fact-icon provider-model-fact-cap">
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
</template>

<style scoped>
.kicker {
  margin: 0;
  color: var(--muted);
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
.provider-model-fact-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-2);
}
.provider-model-fact-icon :deep(.projector-icon) {
  width: 16px;
  height: 16px;
}
.chat-only {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
</style>
