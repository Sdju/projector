<script setup lang="ts">
import { computed, ref } from "vue";
import type { GitOverview } from "../../../../core/modules/workspace/index.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import type { GitOverviewState } from "../lib/git-overview.ts";
import type { GitHistoryState } from "../lib/git-history.ts";
import GitChangesTree from "./GitChangesTree.vue";
import GitHistory from "./GitHistory.vue";
import IconPlus from "~icons/lucide/plus";
import IconMinus from "~icons/lucide/minus";
import IconChevronRight from "~icons/lucide/chevron-right";

const props = defineProps<{
  projectId: string;
  overview: GitOverviewState;
  history: GitHistoryState;
  /** Файл активной вкладки: подсвечивается в списке изменений. */
  selected?: { path: string; staged?: boolean };
  /** Сохраняет открытые файлы и ждёт записи перед изменением Git; бросает ошибку при неудаче. */
  prepare: (action: string, paths: string[]) => Promise<void>;
  /** Сбрасывает незавершённое открытие файла: ответ Git устарел для него. */
  invalidate: () => void;
  /** Приводит вкладки и дерево в соответствие с новым состоянием Git. */
  applied: (action: string, paths: string[]) => Promise<void>;
}>();
const emit = defineEmits<{
  open: [path: string, staged?: boolean];
  openCommit: [hash: string];
  openCommitDiff: [hash: string, path: string];
}>();
const { git, error: gitError, loading: gitLoading, load } = props.overview;
const stagedChanges = computed(() =>
  git.value.changes.filter((change) => change.index !== " " && change.index !== "?"),
);
const workingChanges = computed(() =>
  git.value.changes.filter((change) => change.worktree !== " "),
);
const gitBusy = ref(false);
/** Свёрнутые блоки изменений: ключ группы — `staged` или `changed`. */
const collapsedGroups = ref(new Set<string>());
const gitMenu = ref<InstanceType<typeof ContextMenu>>();
const gitTarget = ref({ path: "", staged: false });
const historyOpen = ref(false);
const commitTarget = ref({ hash: "", path: "" });
const gitCommands = useCommandScope(`git:${props.projectId}`, () => ({
  surface: "git",
  projectId: props.projectId,
  path: gitTarget.value.path,
  staged: gitTarget.value.staged,
  busy: gitBusy.value,
  commit: commitTarget.value.hash,
  commitPath: commitTarget.value.path,
  historyOpen: historyOpen.value,
}));
function gitArgs(value?: unknown) {
  const args = commandArgs(value);
  if (args.path !== undefined && typeof args.path !== "string")
    throw new Error("path должен быть строкой");
  if (args.staged !== undefined && typeof args.staged !== "boolean")
    throw new Error("staged должен быть boolean");
  return {
    path: (args.path as string | undefined) ?? gitTarget.value.path,
    staged: (args.staged as boolean | undefined) ?? gitTarget.value.staged,
    confirm: args.confirm === true,
  };
}
function gitChange(value?: unknown) {
  return git.value.changes.find((change) => change.path === gitArgs(value).path);
}
function gitSelection(value: unknown, staged: boolean) {
  const { path } = gitArgs(value);
  return (staged ? stagedChanges.value : workingChanges.value).filter(
    (change) => !path || change.path === path || change.path.startsWith(`${path}/`),
  );
}
const hasConflict = (change: GitOverview["changes"][number]) =>
  change.index === "U" ||
  change.worktree === "U" ||
  ["AA", "DD"].includes(change.index + change.worktree);
for (const [action, title] of [
  ["openDiff", "Открыть изменения"],
  ["openFile", "Открыть файл"],
  ["stage", "Отметить Staged"],
  ["unstage", "Убрать из Staged"],
  ["discard", "Откатить рабочие изменения…"],
] as const) {
  gitCommands.scope.registerCommand({
    id: `ide.git.${action}`,
    title,
    enabled: (value) => {
      if (gitBusy.value) return false;
      if (action === "stage" || action === "unstage") {
        const selection = gitSelection(value, action === "unstage");
        return (
          !!selection.length &&
          (action === "stage" || selection.every((change) => !hasConflict(change)))
        );
      }
      const change = gitChange(value);
      if (!change) return false;
      if (action === "openFile")
        return change.worktree !== "D" && !(change.index === "D" && change.worktree === " ");
      if (action === "openDiff")
        return (
          !hasConflict(change) &&
          (gitArgs(value).staged ? ![" ", "?"].includes(change.index) : change.worktree !== " ")
        );
      return change.worktree !== " " && !hasConflict(change);
    },
    run: async (value) => {
      const { path, staged, confirm } = gitArgs(value);
      if (action === "openFile" || action === "openDiff")
        return emit("open", path, action === "openDiff" ? staged : undefined);
      if (
        action === "discard" &&
        !confirm &&
        !window.confirm(
          gitChange(value)?.index === "?"
            ? `Убрать новый файл ${path}? Он будет перемещён в .projector-trash.`
            : `Откатить рабочие изменения ${path} до подготовленной версии? Несохранённый черновик тоже будет удалён.`,
        )
      )
        return;
      const paths =
        action === "discard"
          ? [path]
          : gitSelection(value, action === "unstage").map((change) => change.path);
      gitBusy.value = true;
      try {
        await props.prepare(action, paths);
        props.invalidate();
        await props.overview.mutate(action, action === "discard" ? path : paths);
        await props.applied(action, paths);
      } finally {
        gitBusy.value = false;
      }
    },
  });
}
gitCommands.scope.registerCommand({
  id: "ide.git.group.toggle",
  title: "Свернуть или развернуть блок изменений",
  description: "Сворачивает блок Staged или Changed в панели Git.",
  arguments: { staged: "true — блок Staged, false — блок Changed" },
  run: (value) => {
    const args = commandArgs(value);
    if (typeof args.staged !== "boolean") throw new Error("staged должен быть boolean");
    const key = args.staged ? "staged" : "changed";
    if (collapsedGroups.value.has(key)) collapsedGroups.value.delete(key);
    else collapsedGroups.value.add(key);
  },
});
gitCommands.scope.registerCommand({
  id: "ide.git.refresh",
  title: "Обновить Git",
  run: load,
  enabled: () => !gitBusy.value,
});
const gitMenuItems = computed<ContextMenuItem[]>(() => {
  const args = gitTarget.value;
  const file = !!gitChange(args);
  return [
    ...(file
      ? [gitCommands.item("ide.git.openDiff", args), gitCommands.item("ide.git.openFile", args)]
      : []),
    gitCommands.item(args.staged ? "ide.git.unstage" : "ide.git.stage", args, { separator: true }),
    ...(!args.staged && file ? [gitCommands.item("ide.git.discard", args, { danger: true })] : []),
  ];
});
function gitContext(event: MouseEvent | KeyboardEvent, path: string, staged: boolean) {
  gitTarget.value = { path, staged };
  gitCommands.scope.activate();
  void gitMenu.value?.open(event);
}

defineExpose({
  refresh: () => (gitBusy.value ? undefined : load()),
});
</script>

<template>
  <div
    class="side-content"
    @focusin="gitCommands.scope.activate()"
    @keydown="gitCommands.keydown($event)"
  >
    <p v-if="git.available" class="notice">{{ git.branch }}</p>
    <p v-if="gitLoading" class="notice" role="status">загрузка Git…</p>
    <p v-if="gitError" class="notice error" role="alert">{{ gitError }}</p>
    <p v-else-if="!gitLoading && !git.available" class="notice">
      В этой папке нет Git-репозитория.
    </p>
    <p v-else-if="!gitLoading && !git.changes.length" class="notice">Нет изменений.</p>
    <template
      v-for="group in [
        { label: 'Staged', rows: stagedChanges, staged: true },
        { label: 'Changed', rows: workingChanges, staged: false },
      ]"
      :key="group.label"
    >
      <div v-if="git.available" class="git-group">
        <button
          class="group-toggle"
          :aria-expanded="!collapsedGroups.has(group.staged ? 'staged' : 'changed')"
          data-command="ide.git.group.toggle"
          @click="gitCommands.run('ide.git.group.toggle', { staged: group.staged })"
        >
          <IconChevronRight
            class="chevron"
            :class="{ open: !collapsedGroups.has(group.staged ? 'staged' : 'changed') }"
            aria-hidden="true"
          />
          <h3>
            {{ group.label }} <span v-if="group.rows.length">{{ group.rows.length }}</span>
          </h3>
        </button>
        <UiButton
          v-if="group.rows.length"
          icon
          size="sm"
          :disabled="
            !gitCommands.scope.describe(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
              path: '',
            })?.enabled
          "
          :title="group.staged ? 'Убрать всё из Staged' : 'Отметить всё Staged'"
          :aria-label="group.staged ? 'Убрать всё из Staged' : 'Отметить всё Staged'"
          :data-command="group.staged ? 'ide.git.unstage' : 'ide.git.stage'"
          @click="
            gitCommands.run(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
              path: '',
              staged: group.staged,
            })
          "
        >
          <IconMinus v-if="group.staged" aria-hidden="true" /><IconPlus v-else aria-hidden="true" />
        </UiButton>
      </div>
      <GitChangesTree
        v-if="group.rows.length"
        v-show="!collapsedGroups.has(group.staged ? 'staged' : 'changed')"
        :key="`${projectId}:${group.staged}`"
        :changes="group.rows"
        :staged="group.staged"
        :disabled="gitBusy"
        :can-toggle="
          (path) =>
            !!gitCommands.scope.describe(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
              path,
            })?.enabled
        "
        :selected="selected?.staged === group.staged ? selected.path : ''"
        @change="
          gitCommands.run(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
            path: $event,
            staged: group.staged,
          })
        "
        @target="gitTarget = { path: $event, staged: group.staged }"
        @open="gitCommands.run('ide.git.openDiff', { path: $event, staged: group.staged })"
        @context="(event, path) => gitContext(event, path, group.staged)"
      />
    </template>
    <GitHistory
      v-if="git.available"
      v-model:open="historyOpen"
      v-model:target="commitTarget"
      :history="history"
      :commands="gitCommands"
      :revision="overview.gutterRevision.value"
      @open-commit="emit('openCommit', $event)"
      @open-diff="(hash, path) => emit('openCommitDiff', hash, path)"
      @open-file="emit('open', $event)"
    />
    <ContextMenu ref="gitMenu" :items="gitMenuItems" label="Действия Git" />
  </div>
</template>

<style scoped>
.git-group {
  display: flex;
  align-items: center;
  padding: 6px var(--sp-3) 2px var(--sp-3);
}
.git-group h3 {
  padding: 0;
}
.group-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  text-align: left;
  padding: 2px 0;
}
.chevron {
  width: 12px;
  height: 12px;
  color: var(--faint);
}
.chevron.open {
  transform: rotate(90deg);
}
.notice {
  padding: 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
h3 {
  padding: 10px 12px 4px;
  margin: 0;
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
h3 span {
  margin-left: 6px;
  color: var(--faint);
}
</style>
