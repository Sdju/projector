<script setup lang="ts">
import { computed, ref } from "vue";
import { useGitBlocks } from "../lib/git-blocks.ts";
import type { GitOverview } from "../../../../core/modules/workspace/index.ts";
import ContextMenu from "../../../common/ui/ContextMenu.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import type { GitOverviewState } from "../lib/git-overview.ts";
import type { GitBranchesState } from "../lib/git-branches.ts";
import type { GitHistoryState } from "../lib/git-history.ts";
import GitBlock from "./GitBlock.vue";
import GitBranchBar from "./GitBranchBar.vue";
import GitChangesTree from "./GitChangesTree.vue";
import GitHistory from "./GitHistory.vue";
import IconPlus from "~icons/lucide/plus";
import IconMinus from "~icons/lucide/minus";
import IconRefresh from "~icons/lucide/refresh-cw";

const props = defineProps<{
  projectId: string;
  overview: GitOverviewState;
  history: GitHistoryState;
  branches: GitBranchesState;
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
/** Блоки панели делят высоту; история по умолчанию свёрнута. */
const blocks = useGitBlocks(["staged", "changed", "history"], ["history"]);
const stack = ref<HTMLElement>();
const historyOpen = computed({
  get: () => !blocks.collapsed.value.has("history"),
  set: (open: boolean) => blocks.setCollapsed("history", !open),
});
const gitMenu = ref<InstanceType<typeof ContextMenu>>();
const gitTarget = ref({ path: "", staged: false });
const branchOpen = ref(false);
const branchTarget = ref("");
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
  branch: branchTarget.value,
  branchesOpen: branchOpen.value,
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
    blocks.toggle(args.staged ? "staged" : "changed");
  },
});
gitCommands.scope.registerCommand({
  id: "ide.git.block.reset",
  title: "Вернуть размеры блоков Git",
  description: "Сбрасывает высоты блоков Staged, Changed и History, подогнанные перетаскиванием.",
  run: () => blocks.reset(),
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
    class="side-content git-panel"
    @focusin="gitCommands.scope.activate()"
    @keydown="gitCommands.keydown($event)"
  >
    <GitBranchBar
      v-if="git.available"
      v-model:open="branchOpen"
      v-model:target="branchTarget"
      :branches="branches"
      :commands="gitCommands"
      :revision="overview.gutterRevision.value"
      :prepare="prepare"
      :applied="applied"
      :reload="load"
    />
    <p v-if="gitLoading" class="notice" role="status">загрузка Git…</p>
    <p v-if="gitError" class="notice error" role="alert">{{ gitError }}</p>
    <p v-else-if="!gitLoading && !git.available" class="notice">
      В этой папке нет Git-репозитория.
    </p>
    <p v-else-if="!gitLoading && !git.changes.length" class="notice">Нет изменений.</p>
    <div v-if="git.available" ref="stack" class="git-stack">
      <GitBlock
        v-for="group in [
          { id: 'staged', label: 'Staged', rows: stagedChanges, staged: true },
          { id: 'changed', label: 'Changed', rows: workingChanges, staged: false },
        ]"
        :key="group.id"
        :id="group.id"
        :blocks="blocks"
        :stack="stack"
        :label="group.label"
        command="ide.git.group.toggle"
        @toggle="gitCommands.run('ide.git.group.toggle', { staged: group.staged })"
      >
        <template #title>
          {{ group.label }} <span v-if="group.rows.length" class="count">{{ group.rows.length }}</span>
        </template>
        <template #actions>
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
            <IconMinus v-if="group.staged" aria-hidden="true" /><IconPlus
              v-else
              aria-hidden="true"
            />
          </UiButton>
        </template>
        <GitChangesTree
          v-if="group.rows.length"
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
      </GitBlock>
      <GitBlock
        id="history"
        :blocks="blocks"
        :stack="stack"
        label="History"
        command="ide.git.history.toggle"
        @toggle="gitCommands.run('ide.git.history.toggle')"
      >
        <template #title>
          History
          <span v-if="history.log.value.ahead" class="sync" title="Не отправлено в upstream">
            ↑{{ history.log.value.ahead }}
          </span>
          <span v-if="history.log.value.behind" class="sync" title="Есть в upstream, нет локально">
            ↓{{ history.log.value.behind }}
          </span>
        </template>
        <template #actions>
          <UiButton
            v-if="historyOpen"
            icon
            size="sm"
            :disabled="history.loading.value"
            title="Обновить историю"
            aria-label="Обновить историю"
            data-command="ide.git.history.refresh"
            @click="gitCommands.run('ide.git.history.refresh')"
          >
            <IconRefresh aria-hidden="true" />
          </UiButton>
        </template>
        <GitHistory
          v-model:open="historyOpen"
          v-model:target="commitTarget"
          :history="history"
          :commands="gitCommands"
          :revision="overview.gutterRevision.value"
          @open-commit="emit('openCommit', $event)"
          @open-diff="(hash, path) => emit('openCommitDiff', hash, path)"
          @open-file="emit('open', $event)"
        />
      </GitBlock>
    </div>
    <ContextMenu ref="gitMenu" :items="gitMenuItems" label="Действия Git" />
  </div>
</template>

<style scoped>
/* Блоки делят высоту панели и прокручиваются каждый сам; панель целиком не прокручивается. */
.side-content.git-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.git-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.count {
  color: var(--faint);
}
.sync {
  font: var(--fs-2xs) var(--mono);
  color: var(--warn);
}
.notice {
  padding: 0 var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
