<script setup lang="ts">
import UiHint from "../../../common/ui/UiHint.vue";
import AgentJsonSettings from "./AgentJsonSettings.vue";
import { useAgentHooksSettings } from "../model/hooks-settings.ts";

const { hooks, draft, busy, error, commands } = useAgentHooksSettings();
const activate = () => commands.scope.activate();
</script>

<template>
  <AgentJsonSettings
    label="хуки пользователя (JSON)"
    aria-label="Хуки агента"
    placeholder='{ "hooks": { "Stop": [{ "command": "notify-send Projector готов", "minSeconds": 30 }] } }'
    :text="hooks.text"
    :draft="draft"
    :busy="busy"
    :error="error"
    :activate="activate"
    @update:draft="draft = $event"
    @save="commands.run('ide.agent.hooks.set')"
  >
    <template #summary>
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
    </template>
    <template #help>
      <UiHint>
        События: <code>PreToolUse</code> (перед инструментом; код выхода 2 или ответ
        <code v-pre>{"decision":"block","reason":"…"}</code> запрещает вызов),
        <code>PostToolUse</code> (после; <code v-pre>{"additionalContext":"…"}</code> дописывается к
        результату) и <code>Stop</code> (после ответа; <code>minSeconds</code> — только для долгих
        ходов). <code>matcher</code> — регулярное выражение по имени инструмента. Событие приходит
        хуку в stdin как JSON. Хуки из <code>.projector/hooks.json</code> проекта тоже действуют, но
        включение подтверждаете вы.
      </UiHint>
    </template>
  </AgentJsonSettings>
</template>
