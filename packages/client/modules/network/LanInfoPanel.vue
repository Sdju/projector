<script setup lang="ts">
import UiCard from "../../common/ui/UiCard.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiStack from "../../common/ui/UiStack.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { useId } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { commandArgs } from "../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../common/utilities/tab-readout.ts";
import { useNetworkSettings } from "./model.ts";

const { state, password, busy, status, error, commands } = useNetworkSettings("panel");
// Что штатный агент видит во вкладке локальной сети. Значение пароля не раскрывается.
useTabReadout(() => {
  const note = "Локальная сеть";
  const current = state.value;
  if (!current)
    return {
      note,
      text: readoutLines(
        "Загрузка…",
        busy.value && "Состояние: выполняется…",
        error.value && `Ошибка: ${error.value}`,
      ),
    };
  return {
    note,
    text: readoutLines(
      `Режим: ${current.mode === "lan" ? "Локальная сеть" : "Только localhost"}`,
      `Пароль: ${current.passwordRequired ? "задан" : "не задан"}`,
      current.mode === "lan"
        ? current.lanUrls.length
          ? `Адреса: ${current.lanUrls.join(", ")}`
          : "Адреса: нет"
        : "Сервер доступен только на этой машине",
      busy.value && "Состояние: выполняется…",
      status.value && `Состояние: ${status.value}`,
      error.value && `Ошибка: ${error.value}`,
    ),
  };
});
const passwordId = useId();
async function copyAddress(address: string) {
  error.value = "";
  status.value = "";
  try {
    await navigator.clipboard.writeText(address);
    status.value = "Адрес скопирован";
  } catch {
    error.value = "Не удалось скопировать адрес";
    throw new Error(error.value);
  }
}

commands.scope.registerCommand({
  id: "ide.network.address.copy",
  title: "Скопировать LAN-адрес Projector",
  description:
    "Копирует один из текущих LAN-адресов в буфер обмена. Без address использует первый адрес.",
  arguments: { address: "Один из LAN-адресов текущего сервера" },
  enabled: () => !busy.value && state.value?.mode === "lan" && !!state.value.lanUrls.length,
  run: (value) => {
    const { address = state.value?.lanUrls[0] } = commandArgs(value);
    if (typeof address !== "string" || !state.value?.lanUrls.includes(address))
      throw new Error("Выберите LAN-адрес сервера");
    return copyAddress(address);
  },
});
</script>

<template>
  <div
    class="network-panel"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiMessage v-if="!state" tone="muted" size="sm" class="muted">Загрузка…</UiMessage>
    <template v-else>
      <dl class="summary">
        <UiCard as="div" appearance="frame">
          <dt>Режим</dt>
          <dd>{{ state.mode === "lan" ? "Локальная сеть" : "Только localhost" }}</dd>
        </UiCard>
        <UiCard as="div" appearance="frame">
          <dt>Пароль</dt>
          <dd>{{ state.passwordRequired ? "Задан" : "Не задан" }}</dd>
        </UiCard>
      </dl>

      <UiHeading as="h3" size="sm" :space-after="2" class="section-heading">Адреса</UiHeading>
      <UiStack
        as="ul"
        flow="flex"
        :gap="2"
        v-if="state.mode === 'lan' && state.lanUrls.length"
        class="addresses"
      >
        <UiInline
          as="li"
          :gap="3"
          justify="between"
          v-for="address in state.lanUrls"
          :key="address"
        >
          <code>{{ address }}</code>
          <button :disabled="busy" @click="commands.run('ide.network.address.copy', { address })">
            копировать
          </button>
        </UiInline>
      </UiStack>
      <UiMessage v-else tone="muted" size="sm" class="muted">
        {{
          state.mode === "lan" ? "Адреса сети не найдены" : "Сервер доступен только на этой машине"
        }}
      </UiMessage>

      <UiHeading as="h3" size="sm" :space-after="2" class="section-heading"
        ><UiLabel inline :for="passwordId">Пароль доступа</UiLabel></UiHeading
      >
      <UiInline class="password-row" align="normal" justify="normal">
        <UiControl
          grow
          :id="passwordId"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="Новый пароль"
          :disabled="busy"
        />
        <UiButton
          appearance="solid"
          :disabled="busy || !password"
          @click="commands.run('ide.network.save')"
          >Сохранить</UiButton
        >
        <UiButton
          v-if="state.passwordRequired"
          :disabled="busy"
          @click="commands.run('ide.network.password.clear')"
          >Убрать</UiButton
        >
      </UiInline>
      <UiHint v-if="state.passwordRequired" class="hint"
        >Пароль задан. Введите новый, чтобы заменить, или нажмите «Убрать».</UiHint
      >
      <UiHint v-else class="hint"
        >Без пароля любой в локальной сети сможет управлять Projector, включая терминалы.</UiHint
      >
    </template>

    <UiMessage
      v-if="error || status"
      role="status"
      size="xs"
      class="network-message"
      :tone="error ? 'danger' : undefined"
    >
      {{ error || status }}
    </UiMessage>
  </div>
</template>

<style scoped>
.network-panel {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
  container-type: inline-size;
}
.section-heading {
  margin-top: var(--sp-4);
  color: var(--text-2);
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  margin: 0;
}
dt {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
dd {
  margin: var(--sp-1) 0 0;
  font-weight: 500;
}
.addresses {
  list-style: none;
  margin: 0;
  padding: 0;
}
.addresses li {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.addresses code {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.addresses button {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}

.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.network-message {
  margin: var(--sp-3) 0 0;
}
</style>
