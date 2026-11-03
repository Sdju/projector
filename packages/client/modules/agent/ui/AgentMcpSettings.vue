<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useAgentMcpSettings } from "../model/mcp-settings.ts";

const { mcp, draft, busy, error, commands } = useAgentMcpSettings();
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiField v-slot="{ control }" label="серверы пользователя (JSON)">
      <UiControl
        v-bind="control"
        as="textarea"
        rows="10"
        aria-label="MCP-серверы агента"
        spellcheck="false"
        placeholder='{ "mcpServers": { "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"] } } }'
        :value="draft ?? mcp.text"
        :disabled="busy"
        @input="draft = ($event.target as HTMLTextAreaElement).value"
      />
    </UiField>
    <UiButton
      appearance="solid"
      :disabled="busy || draft === undefined"
      @click="commands.run('ide.agent.mcp.set')"
      >Сохранить</UiButton
    >
    <UiHint v-if="mcp.servers.length">
      Подключаются:
      {{
        mcp.servers
          .map(
            (item) => `${item.name} (${item.source === "user" ? "ваш" : "проект"}, ${item.kind})`,
          )
          .join(", ")
      }}
    </UiHint>
    <UiHint>
      Штатный агент подключает эти серверы в начале каждого ответа и получает их инструменты;
      серверы из <code>.mcp.json</code> проекта подключаются тоже, но запуск подтверждаете вы.
      Инструмент, который не только читает, перед вызовом тоже спрашивает подтверждение (в режиме
      «Без вопросов» — нет). Значения вида <code v-pre>${NAME}</code> берутся из окружения
      Projector. Файл лежит в папке данных Projector и может содержать ключи.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
