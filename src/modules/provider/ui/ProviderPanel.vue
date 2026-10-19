<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiFormGrid from "../../../common/ui/UiFormGrid.vue";

import UiHint from "../../../common/ui/UiHint.vue";
import { computed, onMounted, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { useProviders } from "../model/store.ts";
import { PROVIDER_KINDS, PROVIDER_PRESETS } from "../model/presets.ts";
import { formatAmount, formatBalance } from "../model/format-balance.ts";
import type { ProviderKind } from "../model/types.ts";

const {
  providers,
  activeProviderId,
  error,
  saving,
  keyDrafts,
  load,
  save,
  setActive,
  addProvider,
  removeProvider,
  setKeyDraft,
  patchProvider,
  balances,
  loadBalance,
  loadBalances,
  revision,
} = useProviders();
const selectedId = ref<string | null>(null);
const selected = computed(
  () => providers.value.find((item) => item.id === selectedId.value) ?? providers.value[0] ?? null,
);

onMounted(async () => {
  await load();
  selectedId.value = activeProviderId.value ?? providers.value[0]?.id ?? null;
});
// Balances follow every load or save, so a freshly saved key shows its balance right away.
watch(revision, () => void loadBalances());

const preset = computed(() => PROVIDER_PRESETS[selected.value?.kind ?? "custom"]);
const balance = computed(() => (selected.value ? balances.value[selected.value.id] : undefined));
const hasBalance = computed(() => selected.value?.kind === "deepseek");

function listMeta(item: { id: string; kind: ProviderKind; model: string }): string {
  const value = balances.value[item.id];
  if (item.kind === "deepseek" && value?.status === "ready") return formatBalance(value.entries);
  return item.model || "без модели";
}

function add(kind: ProviderKind): string {
  const id = addProvider(kind);
  selectedId.value = id;
  return id;
}

const commands = useCommandScope("provider-settings", () => ({
  surface: "settings",
  provider: selectedId.value,
}));
commands.scope.registerCommand({
  id: "ide.providers.add",
  title: "Добавить провайдера",
  description:
    "Добавляет провайдера из пресета: deepseek, qwencloud, local или custom (по умолчанию custom). Подставляет адрес и модель; ключ вводится в форме, затем «сохранить».",
  arguments: { kind: "deepseek | qwencloud | local | custom" },
  run: (value) => {
    const kind = commandArgs(value).kind ?? "custom";
    if (!PROVIDER_KINDS.includes(kind as ProviderKind))
      throw new Error("Неизвестный тип провайдера");
    return add(kind as ProviderKind);
  },
});
commands.scope.registerCommand({
  id: "ide.providers.balance.refresh",
  title: "Обновить баланс провайдера",
  description:
    "Запрашивает баланс выбранного провайдера (сейчас только DeepSeek; у Qwen Cloud и локальных баланса по ключу нет).",
  enabled: () => hasBalance.value,
  run: async () => {
    if (selected.value) await loadBalance(selected.value.id);
  },
});

function keyDraft(): string {
  if (!selected.value) return "";
  return keyDrafts.value[selected.value.id] ?? "";
}
</script>

<template>
  <UiStack as="section" :gap="4">
    <UiInline wrap justify="between">
      <p class="kicker">OpenAI-compatible API</p>
      <UiInline wrap :gap="2">
        <UiButton
          v-for="kind in PROVIDER_KINDS"
          :key="kind"
          :title="PROVIDER_PRESETS[kind].label"
          @click="commands.run('ide.providers.add', { kind })"
        >
          + {{ kind === "custom" ? "другой" : PROVIDER_PRESETS[kind].name.split(" ")[0] }}
        </UiButton>
      </UiInline>
    </UiInline>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <UiStack :gap="2">
      <UiActionRow
        v-for="item in providers"
        :key="item.id"
        type="button"
        class="item"
        interaction="selection"
        radius="none"
        :gap="2"
        padding="var(--sp-2) 0"
        :class="{ on: item.id === selected?.id }"
        @click="selectedId = item.id"
      >
        <UiStatusDot class="dot" :tone="item.id === activeProviderId ? 'success' : 'faint'" />
        <span>{{ item.name }}</span>
        <span class="meta">{{ listMeta(item) }}</span>
      </UiActionRow>
    </UiStack>

    <UiStack v-if="selected" class="form" :gap="4">
      <UiField v-slot="{ control }" label="тип">
        <UiControl
          as="select"
          v-bind="control"
          aria-label="Тип провайдера"
          :value="selected.kind"
          @change="
            patchProvider(selected.id, {
              kind: ($event.target as HTMLSelectElement).value as ProviderKind,
            })
          "
        >
          <option v-for="kind in PROVIDER_KINDS" :key="kind" :value="kind">
            {{ PROVIDER_PRESETS[kind].label }}
          </option>
        </UiControl>
      </UiField>
      <UiFormGrid>
        <UiField v-slot="{ control }" label="имя">
          <UiControl
            v-bind="control"
            aria-label="Имя провайдера"
            :value="selected.name"
            @input="patchProvider(selected.id, { name: ($event.target as HTMLInputElement).value })"
          />
        </UiField>
        <UiField v-slot="{ control }" label="модель">
          <UiControl
            v-bind="control"
            aria-label="Модель"
            :value="selected.model"
            spellcheck="false"
            placeholder="qwen3.8-flash"
            @input="
              patchProvider(selected.id, { model: ($event.target as HTMLInputElement).value })
            "
          />
        </UiField>
      </UiFormGrid>
      <UiField v-slot="{ control }" label="url">
        <UiControl
          v-bind="control"
          aria-label="URL API"
          :value="selected.url"
          spellcheck="false"
          placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
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
          :placeholder="
            selected.hasApiKey ? 'ключ сохранён — введите чтобы заменить' : preset.keyPlaceholder
          "
          @input="setKeyDraft(selected.id, ($event.target as HTMLInputElement).value)"
        />
      </UiField>
      <UiHint>
        Ключ хранится в системном хранилище секретов. Можно задать DASHSCOPE_API_KEY / OPENAI_URL в
        окружении. {{ preset.hint }}
      </UiHint>
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
        <UiHint v-else>
          {{
            balance?.message ??
            (selected.hasApiKey ? "загрузка…" : "Сохраните ключ, чтобы увидеть баланс.")
          }}
        </UiHint>
      </UiStack>
      <UiInline wrap justify="between">
        <UiButton
          appearance="outline"
          tone="muted"
          shape="chip"
          :disabled="selected.id === activeProviderId"
          @click="setActive(selected.id)"
        >
          активный
        </UiButton>
        <UiButton tone="danger" @click="removeProvider(selected.id)">удалить</UiButton>
        <UiButton appearance="solid" :disabled="saving" @click="save">
          {{ saving ? "…" : "сохранить" }}
        </UiButton>
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

.item {
  border-bottom: 1px solid var(--line);
}

.item.on span:nth-child(2) {
  color: var(--text);
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

.item span:not(.dot) {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
