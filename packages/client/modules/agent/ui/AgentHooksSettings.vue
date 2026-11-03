<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useAgentHooksSettings } from "../model/hooks-settings.ts";

const { hooks, draft, busy, error, commands } = useAgentHooksSettings();
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiField v-slot="{ control }" label="хуки пользователя (JSON)">
      <UiControl
        v-bind="control"
        as="textarea"
        rows="10"
        aria-label="Хуки агента"
        spellcheck="false"
        placeholder='{ "hooks": { "Stop": [{ "command": "notify-send Projector готов", "minSeconds": 30 }] } }'
        :value="draft ?? hooks.text"
        :disabled="busy"
        @input="draft = ($event.target as HTMLTextAreaElement).value"
      />
    </UiField>
    <UiButton
      appearance="solid"
      :disabled="busy || draft === undefined"
      @click="commands.run('ide.agent.hooks.set')"
      >Сохранить</UiButton
    >
    <UiHint v-if="hooks.hooks.length">
      Действуют:
      {{
        hooks.hooks
          .map(
            (item) =>
              `${item.event}${item.matcher ? " /" + item.matcher + "/" : ""} (${item.source === "user" ? "ваш" : "проект"}): ${item.command}`,
          )
          .join("; ")
      }}
    </UiHint>
    <UiHint>
      События: <code>PreToolUse</code> (перед инструментом; код выхода 2 или ответ
      <code v-pre>{"decision":"block","reason":"…"}</code> запрещает вызов),
      <code>PostToolUse</code> (после; <code v-pre>{"additionalContext":"…"}</code> дописывается к
      результату) и <code>Stop</code> (после ответа; <code>minSeconds</code> — только для долгих
      ходов). <code>matcher</code> — регулярное выражение по имени инструмента. Событие приходит
      хуку в stdin как JSON. Хуки из <code>.projector/hooks.json</code> проекта тоже действуют, но
      включение подтверждаете вы.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
