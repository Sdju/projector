<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiChoiceGroup from "../../common/ui/UiChoiceGroup.vue";
import UiChoiceRow from "../../common/ui/UiChoiceRow.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiHint from "../../common/ui/UiHint.vue";
import { useGatewaySettings } from "./gateway-model.ts";

const { enabled, url, busy, error, ready, commands } = useGatewaySettings();
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
    <UiHint v-if="enabled" class="hint">
      Базовый адрес: <code>{{ url }}</code
      >. Запросы тратят квоту провайдеров. В режиме «только локально» доступ без ключа есть у любого
      процесса на машине; в LAN с паролем он служит ключом (Bearer).
    </UiHint>
    <UiMessage v-if="error" role="status" tone="danger">{{ error }}</UiMessage>
  </section>
</template>

<style scoped>
.gateway-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
</style>
