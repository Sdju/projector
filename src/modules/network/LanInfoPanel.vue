<script setup lang="ts">
import { useId } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { commandArgs } from "../../common/utilities/commands.ts";
import { useNetworkSettings } from "./model.ts";

const { state, password, busy, status, error, commands } = useNetworkSettings("panel");
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
    <p v-if="!state" class="muted">Загрузка…</p>
    <template v-else>
      <dl class="summary">
        <div>
          <dt>Режим</dt>
          <dd>{{ state.mode === "lan" ? "Локальная сеть" : "Только localhost" }}</dd>
        </div>
        <div>
          <dt>Пароль</dt>
          <dd>{{ state.passwordRequired ? "Задан" : "Не задан" }}</dd>
        </div>
      </dl>

      <h3>Адреса</h3>
      <ul v-if="state.mode === 'lan' && state.lanUrls.length" class="addresses">
        <li v-for="address in state.lanUrls" :key="address">
          <code>{{ address }}</code>
          <button :disabled="busy" @click="commands.run('ide.network.address.copy', { address })">
            копировать
          </button>
        </li>
      </ul>
      <p v-else class="muted">
        {{
          state.mode === "lan" ? "Адреса сети не найдены" : "Сервер доступен только на этой машине"
        }}
      </p>

      <h3><label :for="passwordId">Пароль доступа</label></h3>
      <div class="password-row">
        <input
          :id="passwordId"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="Новый пароль"
          :disabled="busy"
        />
        <UiButton
          variant="solid"
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
      </div>
      <UiHint v-if="state.passwordRequired" class="hint"
        >Пароль задан. Введите новый, чтобы заменить, или нажмите «Убрать».</UiHint
      >
      <UiHint v-else class="hint"
        >Без пароля любой в локальной сети сможет управлять Projector, включая терминалы.</UiHint
      >
    </template>

    <p v-if="error || status" role="status" class="message" :class="{ error }">
      {{ error || status }}
    </p>
  </div>
</template>

<style scoped>
.network-panel {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
  container-type: inline-size;
}
h3 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 500;
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  margin: 0;
}
.summary div {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
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
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.addresses li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
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
.password-row {
  display: flex;
  gap: var(--sp-2);
}
.password-row input {
  flex: 1;
  min-width: 0;
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.message {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
