<script setup lang="ts">
import UiHint from "../../../common/ui/UiHint.vue";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { shortPath, projectRoute, previewIconUrl } from "../../project/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentDock } from "../../agent/index.ts";
import { useAddSession } from "../model/session.ts";
import type { LaunchMode, ProjectDraft } from "../../project/index.ts";
import { ProjectForm } from "../../catalog/index.ts";

const {
  query,
  preview,
  existing,
  advanced,
  loading,
  picking,
  error,
  notice,
  fallbackPath,
  busy,
  cancel,
  fromPath,
  pick,
  submitQuery,
  askAgentAboutFallback,
  confirm,
  patchPreview,
} = useAddSession();

const router = useRouter();
const nameInput = ref<HTMLInputElement | null>(null);

const command = computed(() => {
  if (!preview.value) return "";
  return (
    preview.value.commands.find((item) => item.id === preview.value?.defaultCommandId) ??
    preview.value.commands[0]
  );
});

watch(preview, async (value) => {
  if (!value || existing.value) return;
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
});

function setMode(mode: LaunchMode): void {
  if (!preview.value) return;
  preview.value.mode = mode;
}

function onDraft(value: ProjectDraft): void {
  patchPreview(value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && (preview.value || error.value)) {
    event.preventDefault();
    cancel();
  }
}
</script>

<template>
  <section class="composer" @keydown="onKeydown">
    <form class="bar" @submit.prevent="submitQuery">
      <UiButton variant="ghost" :disabled="busy" type="button" @click="pick">
        {{ picking ? "…" : "папка" }}
      </UiButton>
      <input
        v-model="query"
        :disabled="busy"
        :placeholder="picking ? 'выберите папку в диалоге…' : 'путь, папка или «добавь из ~/code»'"
        spellcheck="false"
        autocomplete="off"
      />
      <UiButton variant="solid" :disabled="busy || (!query.trim() && !preview)" type="submit">
        {{ loading ? "…" : preview && !existing ? "добавить" : "далее" }}
      </UiButton>
    </form>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <p v-else-if="error" class="err">
      {{ error }}
      <button v-if="fallbackPath" type="button" class="link" @click="askAgentAboutFallback">
        искать приложения внутри
      </button>
    </p>
    <UiHint v-else-if="!preview">
      Путь или «папка» добавят сразу. Фраза — через агента. Можно бросить каталог сюда.
    </UiHint>

    <article v-if="preview" class="preview">
      <div class="row">
        <img class="icon" :src="previewIconUrl(preview.path)" alt="" />
        <input
          v-if="!existing"
          ref="nameInput"
          v-model="preview.name"
          class="name"
          placeholder="название"
        />
        <strong v-else class="name">{{ preview.name }}</strong>
        <span class="path">{{ shortPath(preview.path) }}</span>
      </div>

      <p v-if="existing" class="status">уже в списке</p>
      <div v-else class="meta">
        <UiButton variant="chip" :active="preview.mode === 'server'" @click="setMode('server')">
          сервер
        </UiButton>
        <UiButton variant="chip" :active="preview.mode === 'window'" @click="setMode('window')">
          окно
        </UiButton>
        <span v-if="command" class="cmd">{{ command.cmd }}</span>
      </div>

      <div class="actions">
        <UiButton v-if="existing" variant="solid" @click="router.push(projectRoute(existing.path))">
          открыть
        </UiButton>
        <template v-else>
          <UiButton variant="ghost" @click="advanced = !advanced">
            {{ advanced ? "скрыть" : "настроить" }}
          </UiButton>
          <UiButton variant="solid" :disabled="loading" @click="confirm">добавить</UiButton>
        </template>
        <UiButton variant="ghost" @click="cancel">отмена</UiButton>
      </div>

      <ProjectForm
        v-if="advanced && !existing"
        class="advanced"
        :model-value="preview"
        submit-label="добавить"
        @update:model-value="onDraft"
        @inspect="fromPath"
        @submit="confirm"
      />
    </article>

    <AgentDock />
  </section>
</template>

<style scoped>
.composer {
  display: grid;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}

.bar {
  display: flex;
  gap: var(--sp-2);
}

.err,
.notice,
.status {
  margin: 0;
  font-size: var(--fs-xs);
}

.err {
  color: var(--err);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: baseline;
}

.notice,
.status {
  color: var(--run);
}

.link {
  color: var(--text);
  font-size: var(--fs-xs);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.preview {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-3) 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
}

.icon {
  width: 28px;
  height: 28px;
  border-radius: var(--r-md);
  object-fit: cover;
  background: var(--bg-2);
  flex: 0 0 auto;
}

.name {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
  flex: 0 1 auto;
  min-width: 120px;
  width: auto;
  padding: var(--sp-1) var(--sp-2);
}

strong.name {
  border: 0;
  padding: 0;
}

.path {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.meta,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: center;
}

.cmd {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.actions {
  justify-content: flex-end;
}

.advanced {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
}
@media (max-width: 700px) {
  .bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }
  .bar > input {
    min-width: 0;
  }
  .bar > button:last-child {
    grid-column: 1 / -1;
  }
  .row {
    flex-wrap: wrap;
  }
  .path {
    flex-basis: 100%;
    margin-left: 0;
  }
}
</style>
