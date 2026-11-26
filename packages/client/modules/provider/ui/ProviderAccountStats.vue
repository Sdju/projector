<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { formatAmount } from "../model/format-balance.ts";
import type { ProviderBalance, ProviderUsage } from "../model/types.ts";

defineProps<{
  hasBalance: boolean;
  balance?: ProviderBalance;
  hasKey: boolean;
  hasUsage: boolean;
  providerUsage?: ProviderUsage;
  providerUsageBusy: boolean;
}>();
const emit = defineEmits<{ refreshBalance: []; refreshUsage: [] }>();
</script>

<template>
  <UiStack v-if="hasBalance" class="balance" :gap="1">
    <UiInline wrap justify="between">
      <span class="kicker">баланс</span>
      <UiButton appearance="outline" tone="muted" shape="chip" @click="emit('refreshBalance')">
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
    <UiLoader v-else-if="!balance?.message && hasKey" size="sm">загрузка…</UiLoader>
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
        @click="emit('refreshUsage')"
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
      <UiInline v-for="item in providerUsage.quotas.slice(0, 4)" :key="item.modelId" wrap :gap="2">
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
</style>
