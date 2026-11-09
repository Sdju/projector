<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import AgentJsonSettings from "./AgentJsonSettings.vue";
import { useAgentMcpSettings } from "../model/mcp-settings.ts";

const { mcp, draft, busy, error, commands } = useAgentMcpSettings();
const activate = () => commands.scope.activate();
</script>

<template>
  <AgentJsonSettings
    label="серверы пользователя (JSON)"
    aria-label="MCP-серверы агента"
    placeholder='{ "mcpServers": { "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"] } } }'
    :text="mcp.text"
    :draft="draft"
    :busy="busy"
    :error="error"
    :activate="activate"
    @update:draft="draft = $event"
    @save="commands.run('ide.agent.mcp.set')"
  >
    <template #summary>
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
    </template>
    <template #help>
      <UiHint>
        Штатный агент подключает эти серверы в начале каждого ответа и получает их инструменты;
        серверы из <code>.mcp.json</code> проекта подключаются тоже, но запуск подтверждаете вы.
        Инструмент, который не только читает, перед вызовом тоже спрашивает подтверждение (в режиме
        «Без вопросов» — нет). Значения вида <code v-pre>${NAME}</code> берутся из окружения
        Projector. Файл лежит в папке данных Projector и может содержать ключи.
      </UiHint>
    </template>
  </AgentJsonSettings>
</template>
