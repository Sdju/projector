<script setup lang="ts">
import { useId } from "vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiChoiceGroup from "../../common/ui/UiChoiceGroup.vue";
import UiChoiceRow from "../../common/ui/UiChoiceRow.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { useGatewaySettings } from "./gateway-model.ts";

const { enabled, hasKey, apiKey, url, busy, error, ready, commands } = useGatewaySettings();
const keyId = useId();
</script>

<template>
  <section
    class="gateway-settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiHeading as="h2" size="sm">OpenAI-совместимый API</UiHeading>
    <UiChoiceGroup label="Состояние" :disabled="!ready || busy">
      <UiChoiceRow
        title="Разрешить другим приложениям"
        description="Приложения на этой машине смогут обращаться к провайдерам Projector как к обычному OpenAI API."
        ><UiControl
          type="checkbox"
          :model-value="enabled"
          @update:model-value="commands.run('ide.openai.gateway.set', { enabled: $event })"
      /></UiChoiceRow>
    </UiChoiceGroup>
    <template v-if="enabled">
      <UiHint class="hint">
        Базовый адрес: <code>{{ url }}</code
        >. Доступен с любого origin; запросы тратят квоту провайдеров.
      </UiHint>
      <UiLabel size="sm" tone="secondary" :space-before="4" :space-after="2" :for="keyId"
        >Ключ доступа (необязательно)</UiLabel
      >
      <UiControl
        :id="keyId"
        v-model="apiKey"
        type="password"
        autocomplete="new-password"
        :placeholder="hasKey ? 'Ключ задан; введите новый, чтобы заменить' : 'Без ключа'"
        :disabled="!ready || busy"
      />
      <UiHint class="hint">
        Клиент передаёт его как <code>Authorization: Bearer …</code> (в поле API key). Без ключа API
        открыт любому процессу и странице в браузере на этой машине.
      </UiHint>
      <UiInline class="actions" align="stretch" wrap>
        <UiButton
          appearance="solid"
          :disabled="!ready || busy || !apiKey.trim()"
          @click="commands.run('ide.openai.gateway.set')"
          >Сохранить ключ</UiButton
        >
        <UiButton
          v-if="hasKey"
          :disabled="!ready || busy"
          @click="commands.run('ide.openai.gateway.set', { apiKey: '' })"
          >Убрать ключ</UiButton
        >
      </UiInline>
    </template>
    <UiMessage v-if="error" role="status" tone="danger">{{ error }}</UiMessage>
  </section>
</template>

<style scoped>
.gateway-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.actions {
  margin-top: var(--sp-4);
}
input[type="password"] {
  max-width: 320px;
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
</style>
