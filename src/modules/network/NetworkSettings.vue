<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiChoiceGroup from "../../common/ui/UiChoiceGroup.vue";
import UiChoiceRow from "../../common/ui/UiChoiceRow.vue";
import UiInline from "../../common/ui/UiInline.vue";

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
    <UiHeading as="h2" size="sm">Доступ по локальной сети</UiHeading>
    <UiChoiceGroup v-slot="{ groupName }" label="Режим доступа" :disabled="!ready || busy">
      <UiChoiceRow
        title="Только локально"
        description="Сервер слушает localhost и недоступен другим устройствам."
        ><UiControl v-model="mode" type="radio" :name="groupName" value="local"
      /></UiChoiceRow>
      <UiChoiceRow
        title="Локальная сеть"
        description="Открывает интерфейс для телефона и других устройств в вашей сети."
        ><UiControl v-model="mode" type="radio" :name="groupName" value="lan"
      /></UiChoiceRow>
    </UiChoiceGroup>
    <template v-if="mode === 'lan'">
      <UiLabel size="sm" tone="secondary" :space-before="4" :space-after="2" :for="passwordId"
        >Пароль доступа (необязательно)</UiLabel
      >
      <UiControl
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
    <UiInline class="actions" align="stretch" wrap>
      <UiButton
        appearance="solid"
        :disabled="!ready || busy"
        @click="commands.run('ide.network.save')"
        >Сохранить и перезапустить</UiButton
      >
      <UiButton
        v-if="passwordRequired"
        :disabled="!ready || busy"
        @click="commands.run('ide.network.password.clear')"
        >Убрать пароль</UiButton
      >
    </UiInline>
    <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">{{
      error || status
    }}</UiMessage>
  </section>
</template>

<style scoped>
.network-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.actions {
  margin-top: var(--sp-4);
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
input[type="password"] {
  max-width: 320px;
}
</style>
