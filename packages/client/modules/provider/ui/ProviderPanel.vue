<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiFormGrid from "../../../common/ui/UiFormGrid.vue";

import UiHint from "../../../common/ui/UiHint.vue";
import { computed, onMounted } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { providerKindExtra } from "../model/kind-extra.ts";
import { useProviders } from "../model/store.ts";
import { THINKING_STYLES } from "../model/presets.ts";
import { combineBalances, formatBalance } from "../model/format-balance.ts";
import type { ProviderKind, ThinkingStyle } from "../model/types.ts";
import ProviderAccountStats from "./ProviderAccountStats.vue";
import ProviderModelsSection from "./ProviderModelsSection.vue";

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

/** A new type brings the thinking dialect that suits it; the user can pick another afterwards. */
function changeKind(kind: ProviderKind): void {
  if (selected.value)
    patchProvider(selected.value.id, { kind, thinkingStyle: presetFor(kind).thinking });
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

      <ProviderModelsSection
        :selected="selected"
        @refresh="commands.run('ide.providers.models.refresh')"
      />
      <ProviderAccountStats
        :has-balance="hasBalance"
        :balance="balance"
        :has-key="!!(selected.hasApiKey || selected.hasBalanceApiKey)"
        :has-usage="hasUsage"
        :provider-usage="providerUsage"
        :provider-usage-busy="providerUsageBusy"
        @refresh-balance="commands.run('ide.providers.balance.refresh')"
        @refresh-usage="commands.run('ide.providers.usage.refresh')"
      />
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
