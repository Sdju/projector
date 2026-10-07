<script setup lang="ts">
import { useId } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { useNetworkSettings } from "./model.ts";

const { mode, passwordRequired, lanUrl, password, busy, error, status, ready, commands } =
  useNetworkSettings("settings");
const passwordId = useId();
</script>

<template>
  <section
    class="network-settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <h2>Доступ по локальной сети</h2>
    <fieldset :disabled="!ready || busy">
      <legend class="sr-only">Режим доступа</legend>
      <label class="mode">
        <input v-model="mode" type="radio" name="network" value="local" />
        <span
          ><strong>Только локально</strong
          ><small>Сервер слушает localhost и недоступен другим устройствам.</small></span
        >
      </label>
      <label class="mode">
        <input v-model="mode" type="radio" name="network" value="lan" />
        <span
          ><strong>Локальная сеть</strong
          ><small>Открывает интерфейс для телефона и других устройств в вашей сети.</small></span
        >
      </label>
    </fieldset>
    <template v-if="mode === 'lan'">
      <label class="password-label" :for="passwordId">Пароль доступа (необязательно)</label>
      <input
        :id="passwordId"
        v-model="password"
        type="password"
        autocomplete="new-password"
        placeholder="Оставьте пустым, чтобы не менять пароль"
        :disabled="!ready || busy"
      />
      <UiHint class="hint">
        <template v-if="passwordRequired"
          >Пароль уже задан. Введите новый, чтобы заменить его, или очистите защиту
          вручную.</template
        >
        <template v-else
          >Без пароля любой в локальной сети сможет управлять Projector, включая
          терминалы.</template
        >
      </UiHint>
      <UiHint v-if="lanUrl" class="hint">
        Адрес для другого устройства: <code>{{ lanUrl }}</code>
      </UiHint>
    </template>
    <div class="actions">
      <UiButton variant="solid" :disabled="!ready || busy" @click="commands.run('ide.network.save')"
        >Сохранить и перезапустить</UiButton
      >
      <UiButton
        v-if="passwordRequired"
        :disabled="!ready || busy"
        @click="commands.run('ide.network.password.clear')"
        >Убрать пароль</UiButton
      >
    </div>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
  </section>
</template>

<style scoped>
.network-settings {
  margin-bottom: var(--sp-6);
}
h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  font-weight: 500;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
}
.mode {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  padding: var(--sp-3) 0;
  cursor: pointer;
}
.mode input {
  margin-top: var(--sp-1);
}
strong {
  display: block;
  font-weight: 500;
}
small {
  display: block;
  color: var(--muted);
  font-size: var(--fs-xs);
  margin-top: var(--sp-1);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.password-label {
  display: block;
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
}
input[type="password"] {
  max-width: 320px;
}
.error {
  color: var(--err);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
