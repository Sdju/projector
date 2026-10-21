<script setup lang="ts">
import { reactive } from "vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentSecretRequest } from "../model/types.ts";
import IconKey from "~icons/lucide/key-round";

defineProps<{ requests: AgentSecretRequest[] }>();
const emit = defineEmits<{ answer: [id: string, value: string | null] }>();

/** Typed values by request. They live only in this form until they are sent. */
const typed = reactive<Record<string, string>>({});

function submit(id: string) {
  const value = typed[id] ?? "";
  if (!value) return;
  delete typed[id];
  emit("answer", id, value);
}

function decline(id: string) {
  delete typed[id];
  emit("answer", id, null);
}
</script>

<template>
  <div v-if="requests.length" class="secrets" role="dialog" aria-label="Запрос секрета">
    <section v-for="request in requests" :key="request.id" class="secret">
      <UiInline as="header" align="center" justify="normal">
        <IconKey aria-hidden="true" />
        <span class="title">{{ request.label }}</span>
      </UiInline>
      <p v-if="request.reason" class="reason">{{ request.reason }}</p>
      <p v-if="request.destination.kind === 'env_file'" class="destination">
        Значение запишется в <code>{{ request.destination.file }}</code> как
        <code>{{ request.destination.key }}</code>
        <span v-if="request.destination.replaces">, заменит текущее</span>. Агент его не увидит.
      </p>
      <p v-else-if="request.destination.kind === 'ai_provider'" class="destination">
        Ключ провайдера <strong>{{ request.destination.name }}</strong
        >, адрес
        <code class="address">{{ request.destination.url }}</code>
        <span v-if="request.destination.model"
          >, модель <code>{{ request.destination.model }}</code></span
        >. Ключ будет отправляться только на этот адрес. Хранится в системном хранилище секретов;
        <span v-if="request.destination.replaces">заменит текущий ключ. </span>Агент его не увидит.
      </p>
      <p v-else class="destination">
        Ключ или токен {{ request.destination.label }}: сохраним в системном хранилище секретов<span
          v-if="request.destination.replaces"
          >, заменит текущий</span
        >. Агент его не увидит.
      </p>
      <form class="entry" @submit.prevent="submit(request.id)">
        <input
          v-model="typed[request.id]"
          class="value"
          type="password"
          name="secret"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="Значение"
          aria-label="Значение секрета"
          data-1p-ignore
          data-lpignore="true"
        />
        <UiInline align="stretch">
          <UiButton type="submit" appearance="solid" size="sm" :disabled="!typed[request.id]">
            Сохранить
          </UiButton>
          <UiButton type="button" size="sm" @click="decline(request.id)"> Отказаться </UiButton>
        </UiInline>
      </form>
    </section>
  </div>
</template>

<style scoped>
/* Над полем ввода поверх переписки, как вопросы агента. */
.secrets {
  position: absolute;
  inset-inline: var(--sp-5);
  bottom: calc(100% + var(--sp-2));
  z-index: var(--z-expanded);
  display: grid;
  gap: var(--sp-2);
  max-height: min(70vh, 560px);
  overflow: auto;
  scrollbar-width: thin;
}
.secret {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line-strong));
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--warn) 6%, var(--bg-2));
  box-shadow: var(--shadow-popover);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: 1.5;
}
header {
  min-width: 0;
}
header svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}
.reason,
.destination {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.address {
  overflow-wrap: anywhere;
}
code {
  font-family: var(--mono);
  color: var(--text);
}
.entry {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
}
.value {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.value:focus {
  border-color: var(--accent);
  outline: none;
}
</style>
