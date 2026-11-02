<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import AgentJudgeFields from "./AgentJudgeFields.vue";
import { useAgentJudgeSettings } from "../model/judge-settings.ts";

const { settings, busy, error, commands } = useAgentJudgeSettings();
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <AgentJudgeFields v-model="settings" :disabled="busy" />
    <UiInline>
      <UiButton appearance="solid" :disabled="busy" @click="commands.run('ide.agent.judge.set')"
        >Сохранить</UiButton
      >
    </UiInline>
    <UiHint>
      Судья оценивает действие по шкале от 1 до 5 и объясняет риск в карточке. Автоматически
      разрешаются только действия не выше выбранного балла и с достаточной уверенностью; баллы 4–5
      не автоматизируются, а ошибка Судьи никогда не разрешает действие. Настройку можно
      переопределить для отдельного чата в меню «Ещё».
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
