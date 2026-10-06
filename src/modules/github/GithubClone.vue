<script setup lang="ts">
import { DEFAULT_ENVIRONMENT_IMAGE } from "../../../core/modules/environment/index.ts";
import { nextTick, onBeforeUnmount, ref, useId } from "vue";
import IconDownload from "~icons/lucide/download";
import IconFolder from "~icons/lucide/folder-open";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import UiButton from "../../common/ui/UiButton.vue";
import UiDialog from "../../common/ui/UiDialog.vue";
import UiDialogActions from "../../common/ui/UiDialogActions.vue";
import { pickFolder, useProjects, type Project } from "../project/index.ts";
import { fetchIntegrations, integrationRequest } from "../integration-api/index.ts";

const props = defineProps<{ repository: string; navigate: (path: string) => Promise<void> }>();
const id = useId();
const dialog = ref<InstanceType<typeof UiDialog>>();
const trigger = ref<HTMLButtonElement>();
const input = ref<HTMLInputElement>();
const directory = ref("");
const mode = ref("docker");
const image = ref(DEFAULT_ENVIRONMENT_IMAGE);
const network = ref(false);
const ports = ref("5173");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const cloned = ref<Project>();
const step = ref("");
let jobId = "";
interface CloneJob {
  id: string;
  phase:
    | "queued"
    | "preparing"
    | "pulling"
    | "cloning"
    | "finishing"
    | "done"
    | "error"
    | "cancelled";
  message: string;
  project?: Project;
}
/** Clones in the background and follows its phases until it finishes or is cancelled. */
async function cloneInBackground(body: unknown) {
  const started = await integrationRequest<{ job: CloneJob }>("/github/clone-jobs", "POST", body);
  jobId = started.job.id;
  try {
    for (;;) {
      const { job } = await integrationRequest<{ job: CloneJob }>(`/github/clone-jobs/${jobId}`);
      step.value = job.message;
      if (job.phase === "done" && job.project) return job.project;
      if (job.phase === "cancelled") throw new Error("Клонирование отменено");
      if (job.phase === "error") throw new Error(job.message);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  } finally {
    jobId = "";
    step.value = "";
  }
}
onBeforeUnmount(() => {
  if (jobId) void integrationRequest(`/github/clone-jobs/${jobId}`, "DELETE").catch(() => {});
});
const projects = useProjects();
const commands = useCommandScope(`github-clone:${id}`, () => ({
  surface: "github-clone",
  projectId: `gh:/${props.repository}`,
}));
commands.scope.registerCommand({
  id: "ide.github.repository.clone.dialog",
  title: "Клонировать репозиторий GitHub",
  description:
    "Открывает выбор папки для клонирования текущего репозитория и перехода в локальный проект.",
  enabled: () => !busy.value,
  run: async () => {
    error.value = "";
    cloned.value = undefined;
    directory.value = "";
    loading.value = true;
    dialog.value?.open();
    try {
      const data = await fetchIntegrations();
      directory.value =
        data.integrations.find((item) => item.id === "github")?.settings.directory || "~/Projects";
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось прочитать настройки";
      directory.value = "~/Projects";
    } finally {
      loading.value = false;
      await nextTick();
      if (dialog.value?.element?.open) input.value?.focus();
    }
  },
});
commands.scope.registerCommand({
  id: "ide.github.repository.clone",
  title: "Клонировать и открыть локальный проект",
  description:
    "Клонирует текущий репозиторий в directory/owner/repository, добавляет в каталог и открывает /projects. Существующие папки не перезаписывает.",
  arguments: {
    directory: "Абсолютная папка назначения или ~/папка",
    environment:
      "local или { kind: docker, image, network: none|bridge, ports: number[] }; по умолчанию настройки диалога",
  },
  enabled: () => !busy.value && !loading.value,
  run: async (value) => {
    const args = commandArgs(value);
    const base = args.directory ?? directory.value;
    if (typeof base !== "string" || !base.trim()) throw new Error("Укажите папку назначения");
    busy.value = true;
    error.value = "";
    try {
      if (!cloned.value) {
        const project = await cloneInBackground({
          repository: props.repository,
          directory: base.trim(),
          environment:
            args.environment ??
            (mode.value === "docker"
              ? {
                  kind: "docker",
                  image: image.value,
                  network: network.value ? "bridge" : "none",
                  ports: network.value
                    ? ports.value
                        .split(",")
                        .filter((port) => port.trim())
                        .map(Number)
                    : [],
                }
              : "local"),
        });
        cloned.value = project;
        projects.ingest(project);
      }
      await props.navigate(cloned.value.path);
      dialog.value?.close();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось клонировать репозиторий";
    } finally {
      busy.value = false;
    }
  },
});
commands.scope.registerCommand({
  id: "ide.github.repository.clone.abort",
  title: "Прервать клонирование",
  description:
    "Отменяет идущее клонирование: останавливает загрузку образа и git clone, удаляет временную папку. Проект не добавляется.",
  enabled: () => busy.value && !!jobId,
  run: async () => {
    await integrationRequest(`/github/clone-jobs/${jobId}`, "DELETE");
  },
});
commands.scope.registerCommand({
  id: "ide.github.repository.clone.cancel",
  title: "Закрыть окно клонирования",
  description: "Закрывает окно клонирования и возвращает фокус в строку пути.",
  enabled: () => !busy.value,
  run: () => dialog.value?.close(),
});
commands.scope.registerCommand({
  id: "ide.github.repository.clone.directory",
  title: "Выбрать папку клонирования",
  description: "Открывает системный выбор папки для локальной копии репозитория.",
  enabled: () => !busy.value && !loading.value && !cloned.value,
  run: async () => {
    try {
      const result = await pickFolder();
      if (result.path) directory.value = result.path;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось выбрать папку";
    }
  },
});
function cancel(event: Event) {
  event.preventDefault();
  if (!busy.value) commands.run("ide.github.repository.clone.cancel");
}
</script>

<template>
  <button
    ref="trigger"
    class="clone-trigger"
    title="Клонировать репозиторий"
    aria-label="Клонировать репозиторий"
    aria-haspopup="dialog"
    :disabled="busy"
    @click="commands.run('ide.github.repository.clone.dialog')"
  >
    <IconDownload aria-hidden="true" />
  </button>
  <Teleport to="body">
    <UiDialog
      ref="dialog"
      :labelledby="id"
      width="520px"
      @keydown.stop
      @cancel="cancel"
      @close="trigger?.focus()"
    >
      <form @submit.prevent="commands.run('ide.github.repository.clone')" :aria-busy="busy">
        <h2 :id="id">Клонировать репозиторий</h2>
        <p class="repository">{{ repository }}</p>
        <label :for="`${id}-directory`">Папка назначения</label>
        <div class="directory">
          <input
            :id="`${id}-directory`"
            ref="input"
            v-model="directory"
            required
            :disabled="busy || loading || !!cloned"
            autocomplete="off"
            spellcheck="false"
          />
          <UiButton
            title="Выбрать папку"
            aria-label="Выбрать папку"
            :disabled="busy || loading || !!cloned"
            @click="commands.run('ide.github.repository.clone.directory')"
            ><IconFolder aria-hidden="true"
          /></UiButton>
        </div>
        <p v-if="directory" class="destination">
          {{ directory.replace(/\/$/, "") }}/{{ repository }}
        </p>
        <label :for="`${id}-mode`">Окружение</label>
        <select :id="`${id}-mode`" v-model="mode" :disabled="busy || !!cloned">
          <option value="docker">Docker — изолированный запуск</option>
          <option value="local">Локально — запуск на хосте</option>
        </select>
        <template v-if="mode === 'docker'">
          <label :for="`${id}-image`">Образ</label>
          <input :id="`${id}-image`" v-model="image" :disabled="busy || !!cloned" required />
          <label class="network"
            ><input v-model="network" type="checkbox" :disabled="busy || !!cloned" /> Разрешить сеть
            (интернет и локальная сеть)</label
          >
          <template v-if="network">
            <label :for="`${id}-ports`">Порты приложения</label>
            <input
              :id="`${id}-ports`"
              v-model="ports"
              placeholder="5173, 3000"
              :disabled="busy || !!cloned"
            />
          </template>
          <p>
            Контейнеру доступна только папка проекта. Установка зависимостей — из терминала; без
            сети она недоступна.
          </p>
        </template>
        <p v-if="loading" role="status">Читаю настройки…</p>
        <p v-if="busy" role="status">
          {{ cloned ? "Открываю проект…" : step || "Запускаю…" }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <UiDialogActions>
          <UiButton
            v-if="busy && !cloned"
            @click="commands.run('ide.github.repository.clone.abort')"
            >Прервать</UiButton
          >
          <UiButton v-else @click="commands.run('ide.github.repository.clone.cancel')"
            >Отмена</UiButton
          >
          <UiButton type="submit" variant="solid" :disabled="busy || loading || !directory.trim()">
            {{ cloned ? "Открыть проект" : "Клонировать" }}
          </UiButton>
        </UiDialogActions>
      </form>
    </UiDialog>
  </Teleport>
</template>

<style scoped>
.clone-trigger {
  display: grid;
  place-items: center;
  width: 22px;
  height: 26px;
  border-radius: var(--r-sm);
  color: var(--faint);
}
.clone-trigger:hover {
  background: var(--active);
  color: var(--text);
}
.clone-trigger svg {
  width: 13px;
  height: 13px;
}
h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-md);
  font-weight: 500;
}
p {
  margin: var(--sp-3) 0;
  font-size: var(--fs-xs);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.repository,
.destination {
  font-family: var(--mono);
}
select {
  width: 100%;
  margin-bottom: var(--sp-3);
}
.network {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.network input {
  width: auto;
}
label {
  display: block;
  margin-bottom: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--muted);
}
.directory {
  display: flex;
  gap: var(--sp-2);
}
.directory input {
  flex: 1;
  min-width: 0;
}
.directory svg {
  width: 16px;
  height: 16px;
}
.error {
  color: var(--err);
}
@media (max-width: 700px) {
  .clone-trigger {
    width: 32px;
    min-height: var(--control-h-sm);
  }
}
</style>
