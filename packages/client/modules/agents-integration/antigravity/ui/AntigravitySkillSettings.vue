<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import UiInline from "../../../../common/ui/UiInline.vue";
import UiSettingsSection from "../../../../common/ui/UiSettingsSection.vue";
import { useAntigravitySkill } from "../model/skill.ts";

const { state, busy, error, commands } = useAntigravitySkill();
const activate = () => commands.scope.activate();

const statusLabel = computed(() => {
  const status = state.value?.status;
  if (status === "installed") return "Установлен и актуален";
  if (status === "outdated") return "Установлен, есть обновление";
  if (status === "missing") return "Не установлен";
  return "Проверка…";
});

const installLabel = computed(() =>
  state.value?.status === "missing" ? "Установить навык" : "Обновить навык",
);
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error">
    <UiHint wrap>
      Antigravity работает в строгом режиме тонкого ACP-клиента и не получает скрытых инъекций в
      промпт. Установите официальный навык <code>projector</code>, чтобы <code>agy</code> сам
      подгружал справку по виджетам, MCP-командам IDE, ролям и навыкам Projector по запросу.
    </UiHint>

    <div v-if="state" class="card">
      <div class="meta">
        <span class="status" :data-status="state.status">{{ statusLabel }}</span>
        <code class="path">{{ state.file }}</code>
      </div>
      <UiInline wrap :gap="2">
        <UiButton
          appearance="solid"
          :disabled="busy || state.status === 'installed'"
          @click="commands.run('ide.antigravity.skill.install')"
        >
          {{ installLabel }}
        </UiButton>
        <UiButton
          :disabled="busy || state.status === 'missing'"
          @click="commands.run('ide.antigravity.skill.remove')"
        >
          Удалить
        </UiButton>
      </UiInline>
      <details class="preview">
        <summary>Показать содержимое SKILL.md</summary>
        <pre><code>{{ state.content }}</code></pre>
      </details>
    </div>
  </UiSettingsSection>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.status {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text);
}
.status[data-status="installed"] {
  color: var(--ok, var(--text));
}
.status[data-status="outdated"] {
  color: var(--warn, var(--text));
}
.path {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.preview summary {
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.preview pre {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-2);
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-soft, transparent);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
