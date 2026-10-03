<script setup lang="ts">
import { ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import { useCommandRegistrar } from "../../../common/utilities/commands.ts";
import { useDockerState } from "../model.ts";

const { snapshot, busy, commands } = useDockerState();
const name = ref("");
const primaryFile = ref("");
const extraFiles = ref("");
const profiles = ref("");
const envFiles = ref("");
const open = ref(false);
const advanced = ref(false);
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const register = useCommandRegistrar(commands.scope);
register(
  "ide.docker.binding.edit",
  "Настроить Compose-привязку",
  "Раскрывает или сворачивает параметры Compose текущего проекта.",
  () => {
    open.value = !open.value;
  },
);
register(
  "ide.docker.binding.options",
  "Показать дополнительные параметры Compose",
  "Раскрывает дополнительные Compose-файлы, profiles и env-файлы.",
  () => {
    advanced.value = !advanced.value;
  },
);
watch(
  () => JSON.stringify([snapshot.value?.binding, snapshot.value?.detectedFiles]),
  () => {
    const binding = snapshot.value?.binding;
    const files = binding?.files ?? snapshot.value?.detectedFiles.slice(0, 1) ?? [];
    name.value = binding?.name ?? "";
    primaryFile.value = files[0] ?? "";
    extraFiles.value = files.slice(1).join("\n");
    profiles.value = binding?.profiles.join(", ") ?? "";
    envFiles.value = binding?.envFiles.join("\n") ?? "";
  },
  { immediate: true },
);
</script>

<template>
  <details :open="open || !snapshot?.binding" class="binding">
    <summary @click.prevent="commands.run('ide.docker.binding.edit')">
      {{ snapshot?.binding ? `Compose · ${snapshot.binding.name}` : "Подключить Compose" }}
    </summary>
    <form
      @submit.prevent="
        commands.run('ide.docker.binding.save', {
          context: snapshot!.context,
          name,
          files: [primaryFile.trim(), ...lines(extraFiles)],
          profiles: profiles
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          envFiles: lines(envFiles),
        })
      "
    >
      <div class="primary-fields">
        <UiField label="Имя окружения">
          <input
            v-model="name"
            aria-label="Имя окружения"
            required
            pattern="[a-z0-9][a-z0-9_-]*"
            :disabled="busy"
            placeholder="my-project"
            spellcheck="false"
          />
        </UiField>
        <UiField label="Compose-файл">
          <input
            v-model="primaryFile"
            aria-label="Compose-файл"
            required
            :disabled="busy"
            placeholder="compose.yaml"
            spellcheck="false"
          />
        </UiField>
      </div>
      <details :open="advanced" class="advanced">
        <summary @click.prevent="commands.run('ide.docker.binding.options')">Дополнительно</summary>
        <div class="advanced-fields">
          <UiField label="Дополнительные Compose-файлы">
            <textarea
              v-model="extraFiles"
              aria-label="Дополнительные Compose-файлы"
              :disabled="busy"
              placeholder="compose.override.yaml"
              rows="2"
              spellcheck="false"
            />
          </UiField>
          <UiField label="Env-файлы">
            <textarea
              v-model="envFiles"
              aria-label="Env-файлы"
              :disabled="busy"
              placeholder=".env.local"
              rows="2"
              spellcheck="false"
            />
          </UiField>
          <UiField label="Profiles">
            <input
              v-model="profiles"
              aria-label="Profiles"
              :disabled="busy"
              placeholder="dev, debug"
              spellcheck="false"
            />
          </UiField>
        </div>
      </details>
      <div class="actions">
        <UiButton type="submit" :disabled="busy">Сохранить</UiButton>
        <UiButton
          v-if="snapshot?.binding"
          :disabled="busy"
          @click="commands.run('ide.docker.binding.save', { binding: null })"
          >Отвязать</UiButton
        >
      </div>
    </form>
  </details>
</template>

<style scoped>
.binding {
  padding: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
summary {
  cursor: pointer;
}
form {
  max-width: 760px;
  padding-block: var(--sp-4) var(--sp-1);
}
.primary-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: var(--sp-3);
}
input,
textarea {
  min-width: 0;
  font: var(--fs-xs) var(--mono);
}
.advanced {
  margin-block: var(--sp-3);
  color: var(--muted);
}
.advanced > summary {
  font-size: var(--fs-2xs);
}
.advanced-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--sp-3);
  padding-top: var(--sp-3);
  color: var(--text);
}
.advanced-fields > :last-child {
  grid-column: 1 / -1;
}
.actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
@media (max-width: 700px) {
  .primary-fields,
  .advanced-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
