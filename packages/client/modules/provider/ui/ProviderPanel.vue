<script setup lang="ts">
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
import { useProviders } from "../model/store.ts";
import { THINKING_STYLES } from "../model/presets.ts";
import { combineBalances, formatAmount, formatBalance } from "../model/format-balance.ts";
import type { ModelPrice, ProviderKind, ThinkingStyle } from "../model/types.ts";

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
  save,
  setActive,
  addProvider,
  removeProvider,
  setKeyDraft,
  patchProvider,
  balances,
  loadBalance,
  loadBalances,
  fetchModels,
  registerModel,
  unregisterModel,
  renameModel,
  setModelContext,
  setModelPrice,
  setModelThinking,
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
}
const filter = ref("");
// Registered models first, then the rest of what the provider offers upstream.
const rows = computed<ModelRow[]>(() => {
  const item = selected.value;
  if (!item) return [];
  const registered = item.models.map((row) => ({ ...row, on: true }));
  const known = new Set(item.models.map((row) => row.id));
  const rest = (remoteModels.value[item.id] ?? [])
    .filter((id) => !known.has(id))
    .map((id) => ({ id, alias: id, on: false }));
  const needle = filter.value.trim().toLowerCase();
  return [...registered, ...rest].filter(
    (row) =>
      !needle || row.id.toLowerCase().includes(needle) || row.alias.toLowerCase().includes(needle),
  );
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
    "Добавляет провайдера из пресета: deepseek, qwencloud, local или custom (по умолчанию custom), а также вид, объявленный включённым плагином. Подставляет адрес и модель; ключ вводится в форме, затем «сохранить».",
  arguments: { kind: "deepseek | qwencloud | local | custom | <вид из плагина>" },
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
    "Запрашивает у выбранного провайдера список моделей (GET /models по схеме OpenAI) и показывает их в карточке; затем модели регистрируются командой ide.providers.models.register.",
  enabled: () => Boolean(selected.value?.url),
  run: async () => {
    if (selected.value) await fetchModels(selected.value.id);
  },
});
commands.scope.registerCommand({
  id: "ide.providers.models.register",
  title: "Зарегистрировать модель провайдера",
  description:
    "Добавляет модель выбранного провайдера: model — id у провайдера, alias — имя, под которым её увидят агент и шлюз (по умолчанию тот же id). Затем «сохранить».",
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
    "Запрашивает баланс выбранного провайдера: DeepSeek и виды, для которых включённый плагин зарегистрировал читатель.",
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
            :placeholder="selected.hasApiKey ? 'сохранён — введите новый' : preset.keyPlaceholder"
            @input="setKeyDraft(selected.id, ($event.target as HTMLInputElement).value)"
          />
        </UiField>
      </UiFormGrid>
      <UiHint>{{ preset.hint }}</UiHint>

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
        <UiControl
          v-if="rows.length > 8 || filter"
          v-model="filter"
          aria-label="Фильтр моделей"
          placeholder="фильтр"
          spellcheck="false"
        />
        <UiScrollArea v-if="rows.length" class="list">
          <label v-for="row in rows" :key="row.id" class="row" :class="{ off: !row.on }">
            <UiControl
              type="checkbox"
              :aria-label="`Зарегистрировать ${row.id}`"
              :model-value="row.on"
              @update:model-value="toggle(row, Boolean($event))"
            />
            <span class="mid">{{ row.id }}</span>
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
          </label>
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
        <UiLoader v-else-if="!balance?.message && selected.hasApiKey" size="sm">загрузка…</UiLoader>
        <UiHint v-else>{{ balance?.message ?? "Сохраните ключ, чтобы увидеть баланс." }}</UiHint>
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
