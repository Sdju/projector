<script setup lang="ts">
import UiButton from "../../common/ui/UiButton.vue";
import UiControl, { type UiControlHandle } from "../../common/ui/UiControl.vue";
import UiDialog from "../../common/ui/UiDialog.vue";
import UiDialogActions from "../../common/ui/UiDialogActions.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { DEFAULT_ENVIRONMENT_IMAGE } from "@projector/core/modules/environment/index.ts";
import { computed, nextTick, onBeforeUnmount, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { pickFolder, useProjects, type Project } from "../project/index.ts";
import { fetchIntegrations, integrationRequest } from "./client.ts";
import IconFolder from "~icons/lucide/folder-open";

type CloneSource = "github" | "gitlab";
const props = defineProps<{
  source: CloneSource;
  /** Canonical host/repository identifier shown in the dialog and sent to the API. */
  repository: string;
  /** Name under the destination folder: repository name or GitLab `<group>/<project>`. */
  destinationName: string;
  projectId: string;
  navigate: (path: string) => Promise<void>;
}>();
const emit = defineEmits<{ cloned: [project: Project] }>();

const TEXT: Record<
  CloneSource,
  {
    dialog: string;
    dialogCommand: string;
    dialogDescription: string;
    cloneDescription: string;
    abortDescription: string;
    directoryDescription: string;
    fallback: string;
  }
> = {
  github: {
    dialog: "Клонировать репозиторий",
    dialogCommand: "Клонировать репозиторий GitHub",
    dialogDescription:
      "Открывает выбор папки для клонирования текущего репозитория и перехода в локальный проект.",
    cloneDescription:
      "Клонирует текущий репозиторий в папку/имя репозитория, добавляет в каталог и открывает /projects. Существующие папки не перезаписывает.",
    abortDescription:
      "Отменяет идущее клонирование: останавливает загрузку образа и git clone, удаляет временную папку. Проект не добавляется.",
    directoryDescription: "Открывает системный выбор папки для локальной копии репозитория.",
    fallback: "Не удалось клонировать репозиторий",
  },
  gitlab: {
    dialog: "Клонировать проект",
    dialogCommand: "Клонировать проект GitLab",
    dialogDescription:
      "Открывает выбор папки для клонирования текущего проекта GitLab и перехода в локальный проект.",
    cloneDescription:
      "Клонирует текущий проект GitLab в папку/<group>/<project>, добавляет в каталог и открывает /projects. Существующие папки не перезаписывает.",
    abortDescription:
      "Отменяет идущее клонирование: останавливает загрузку образа и git clone, удаляет временную папку. Проект не добавляется.",
    directoryDescription: "Открывает системный выбор папки для локальной копии проекта GitLab.",
    fallback: "Не удалось клонировать проект",
  },
};

const text = TEXT[props.source];
const apiBase = `/${props.source}/clone-jobs`;
const commandPrefix = `ide.${props.source}.repository.clone`;
const id = useId();
const dialog = ref<InstanceType<typeof UiDialog>>();
const input = ref<UiControlHandle>();
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
  const started = await integrationRequest<{ job: CloneJob }>(apiBase, "POST", body);
  jobId = started.job.id;
  try {
    for (;;) {
      const { job } = await integrationRequest<{ job: CloneJob }>(`${apiBase}/${jobId}`);
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
  if (jobId) void integrationRequest(`${apiBase}/${jobId}`, "DELETE").catch(() => {});
});
const projects = useProjects();
const commands = useCommandScope(`${props.source}-clone:${props.projectId}`, () => ({
  surface: `${props.source}-clone`,
  projectId: props.projectId,
}));
commands.scope.registerCommand({
  id: `${commandPrefix}.dialog`,
  title: text.dialogCommand,
  description: text.dialogDescription,
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
        data.integrations.find((item) => item.id === props.source)?.settings.directory ||
        "~/Projects";
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
  id: commandPrefix,
  title: "Клонировать и открыть локальный проект",
  description: text.cloneDescription,
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
        emit("cloned", project);
      }
      await props.navigate(cloned.value.path);
      dialog.value?.close();
    } catch (err) {
      error.value = err instanceof Error ? err.message : text.fallback;
    } finally {
      busy.value = false;
    }
  },
});
commands.scope.registerCommand({
  id: `${commandPrefix}.abort`,
  title: "Прервать клонирование",
  description: text.abortDescription,
  enabled: () => busy.value && !!jobId,
  run: async () => {
    await integrationRequest(`${apiBase}/${jobId}`, "DELETE");
  },
});
commands.scope.registerCommand({
  id: `${commandPrefix}.cancel`,
  title: "Закрыть окно клонирования",
  description: "Закрывает окно клонирования и возвращает фокус в строку пути.",
  palette: false,
  enabled: () => !busy.value,
  run: () => dialog.value?.close(),
});
commands.scope.registerCommand({
  id: `${commandPrefix}.directory`,
  title: "Выбрать папку клонирования",
  description: text.directoryDescription,
  palette: false,
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
const destination = computed(() => {
  const base = directory.value.trim().replace(/[\\/]+$/, "");
  if (!base || !props.destinationName) return "";
  const sep = base.includes("\\") ? "\\" : "/";
  const suffix = props.destinationName.split("/").filter(Boolean).join(sep);
  return `${base}${sep}${suffix}`;
});
function cancel(event: Event) {
  event.preventDefault();
  if (!busy.value) commands.run(`${commandPrefix}.cancel`);
}
</script>

<template>
  <Teleport to="body">
    <UiDialog ref="dialog" :labelledby="id" width="520px" @keydown.stop @cancel="cancel">
      <form @submit.prevent="commands.run(commandPrefix)" :aria-busy="busy">
        <UiHeading :id="id">{{ text.dialog }}</UiHeading>
        <p class="repository">{{ repository }}</p>
        <UiLabel size="xs" tone="muted" :space-after="2" :for="`${id}-directory`"
          >Папка назначения</UiLabel
        >
        <UiInline class="directory" align="normal" justify="normal">
          <UiControl
            grow
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
            @click="commands.run(`${commandPrefix}.directory`)"
            ><IconFolder aria-hidden="true"
          /></UiButton>
        </UiInline>
        <p v-if="destination" class="destination">{{ destination }}</p>
        <UiLabel size="xs" tone="muted" :space-after="2" :for="`${id}-mode`">Окружение</UiLabel>
        <UiControl as="select" :id="`${id}-mode`" v-model="mode" :disabled="busy || !!cloned">
          <option value="docker">Docker — изолированный запуск</option>
          <option value="local">Локально — запуск на хосте</option>
        </UiControl>
        <template v-if="mode === 'docker'">
          <UiLabel size="xs" tone="muted" :space-after="2" :for="`${id}-image`">Образ</UiLabel>
          <UiControl :id="`${id}-image`" v-model="image" :disabled="busy || !!cloned" required />
          <UiInline as="label" class="network" justify="normal"
            ><UiControl v-model="network" type="checkbox" :disabled="busy || !!cloned" /> Разрешить
            сеть (интернет и локальная сеть)</UiInline
          >
          <template v-if="network">
            <UiLabel size="xs" tone="muted" :space-after="2" :for="`${id}-ports`"
              >Порты приложения</UiLabel
            >
            <UiControl
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
        <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
        <UiDialogActions>
          <UiButton v-if="busy && !cloned" @click="commands.run(`${commandPrefix}.abort`)"
            >Прервать</UiButton
          >
          <UiButton v-else @click="commands.run(`${commandPrefix}.cancel`)">Отмена</UiButton>
          <UiButton
            type="submit"
            appearance="solid"
            :disabled="busy || loading || !directory.trim()"
          >
            {{ cloned ? "Открыть проект" : "Клонировать" }}
          </UiButton>
        </UiDialogActions>
      </form>
    </UiDialog>
  </Teleport>
</template>

<style scoped>
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
  margin-bottom: var(--sp-3);
}
.network {
  margin-top: var(--sp-3);
  margin-bottom: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--muted);
}
.directory svg {
  width: 16px;
  height: 16px;
}
</style>
