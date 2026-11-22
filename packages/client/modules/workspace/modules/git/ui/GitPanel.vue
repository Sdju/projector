<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import { computed, inject, ref } from "vue";
import ContextMenu from "../../../../../common/ui/ContextMenu.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiSectionRefresh from "../../../../../common/ui/UiSectionRefresh.vue";
import type { ContextMenuItem } from "../../../../../common/ui/context-menu.ts";
import { toastErrors } from "../../../../../common/utilities/notice.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import type { GitOverviewState } from "../lib/git-overview.ts";
import type { GitBranchesState } from "../lib/git-branches.ts";
import type { GitHistoryState } from "../lib/git-history.ts";
import { registerChangeCommands } from "../lib/change-commands.ts";
import { workspaceProfile, workspaceCapabilities } from "../../../../workspace-api/index.ts";
import GitBranchBar from "./GitBranchBar.vue";
import GitSplitter from "./GitSplitter.vue";
import GitChangesTree from "./GitChangesTree.vue";
import GitHistory from "./GitHistory.vue";

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
  /** Показывает путь в дереве файлов проекта. */
  reveal: (path: string) => void;
}>();
const emit = defineEmits<{
  open: [path: string, staged?: boolean, pinned?: boolean];
  openCommit: [hash: string];
  openCommitTree: [hash: string];
  openCommitDiff: [hash: string, path: string, pinned?: boolean];
}>();
/** Review of the working copy; absent when the workspace did not start one. */
interface ReviewHost {
  comments: { value: readonly { path: string; staged?: boolean }[] };
  sentAt: { value?: number };
  open: () => void;
  sendToChat: () => Promise<unknown>;
}
const review = inject<ReviewHost | undefined>(Symbol.for("projector.review"), undefined);
const reviewCount = computed(() => review?.comments.value.length ?? 0);
const reviewLabel = computed(() => {
  const n = reviewCount.value;
  const mod100 = n % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return `${n} замечаний`;
  if (mod10 === 1) return `${n} замечание`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} замечания`;
  return `${n} замечаний`;
});
function commentCount(path: string, staged: boolean) {
  const list = review?.comments.value;
  if (!list?.length) return 0;
  let count = 0;
  for (const item of list) {
    if (item.path !== path) continue;
    if (staged ? item.staged === true : item.staged !== true) count++;
  }
  return count;
}
const { git, error: gitError, loading: gitLoading, load } = props.overview;
toastErrors(() => gitError.value, { label: "Обновить", run: () => void load() });
const gitBusy = ref(false);
/** Свёрнутые блоки изменений: ключ группы — `staged` или `changed`. */
const collapsedGroups = ref(new Set<string>());
const gitMenu = ref<InstanceType<typeof ContextMenu>>();
const gitTarget = ref({ path: "", staged: false });
const gitProvider = workspaceProfile(props.projectId).providers.git;
const writable = !!gitProvider?.write;
const snapshots = workspaceCapabilities(props.projectId).snapshots;
const historyOpen = ref(!writable);
/** Высота истории, подогнанная перетаскиванием; без неё история занимает место по содержимому. */
const historyHeight = ref<number>();
const stack = ref<HTMLElement>();
const historyZone = ref<HTMLElement>();
const historyStyle = computed(() =>
  !writable
    ? { flex: "1 1 0", maxHeight: "none" }
    : !historyOpen.value
      ? { flex: "0 0 auto" }
      : historyHeight.value
        ? { flex: `0 0 ${historyHeight.value}px` }
        : { flex: "0 1 auto" },
);
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
const { gitChange, stagedChanges, workingChanges } = registerChangeCommands({
  commands: gitCommands,
  overview: props.overview,
  target: gitTarget,
  busy: gitBusy,
  prepare: props.prepare,
  invalidate: props.invalidate,
  applied: props.applied,
  open: (path, staged, pinned) => emit("open", path, staged, pinned),
  reveal: (path) => props.reveal(path),
});
gitCommands.scope.registerCommand({
  id: "ide.git.group.toggle",
  enabled: () => writable,
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
  id: "ide.git.history.resize",
  enabled: () => writable,
  title: "Изменить высоту истории Git",
  description:
    "Задаёт высоту блока History в пикселях; без height возвращает размер по содержимому.",
  arguments: { height: "Высота в пикселях; не меньше 120" },
  run: (value) => {
    const { height } = commandArgs(value);
    if (height !== undefined && (typeof height !== "number" || !(height >= 120)))
      throw new Error("height должен быть числом не меньше 120");
    historyHeight.value = height as number | undefined;
    if (height !== undefined) historyOpen.value = true;
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
    gitCommands.item("ide.git.reveal", args),
    gitCommands.item(args.staged ? "ide.git.unstage" : "ide.git.stage", args, { separator: true }),
    ...(!args.staged ? [gitCommands.item("ide.git.discard", args, { danger: true })] : []),
  ];
});
function gitContext(event: MouseEvent | KeyboardEvent, path: string, staged: boolean) {
  gitTarget.value = { path, staged };
  gitCommands.scope.activate();
  void gitMenu.value?.open(event);
}

defineExpose({
  refresh: () => (gitBusy.value ? undefined : load()),
  refreshing: gitLoading,
});
</script>

<template>
  <UiScrollArea
    class="side-content git-panel"
    @focusin="gitCommands.scope.activate()"
    @keydown="gitCommands.keydown($event)"
  >
    <GitBranchBar
      v-if="git.available && writable"
      v-model:open="branchOpen"
      v-model:target="branchTarget"
      :branches="branches"
      :commands="gitCommands"
      :revision="overview.gutterRevision.value"
      :prepare="prepare"
      :applied="applied"
      :reload="load"
    />
    <div v-else class="git-refresh">
      <UiSectionRefresh />
    </div>
    <div v-if="review && writable && git.available && reviewCount" class="review-summary">
      <button
        type="button"
        class="review-open"
        title="Открыть вкладку ревью"
        data-command="ide.review.open"
        @click="review.open()"
      >
        <ProjectorIcon name="message-square" class="review-icon" aria-hidden="true" />
        <span class="u-truncate">{{ reviewLabel }}</span>
      </button>
      <UiButton
        size="sm"
        appearance="quiet"
        class="review-send"
        title="Положить замечания в черновик чата агента"
        data-command="ide.review.toChat"
        @click="review.sendToChat()"
      >
        <ProjectorIcon name="message-square-share" class="review-send-icon" aria-hidden="true" />
        В чат
      </UiButton>
    </div>
    <p v-if="!gitLoading && !gitError && !git.available" class="notice">
      В этой папке нет Git-репозитория.
    </p>
    <p v-else-if="writable && !gitLoading && !gitError && !git.changes.length" class="notice">
      Нет изменений.
    </p>
    <div v-if="git.available" ref="stack" class="git-stack">
      <div v-if="writable" class="changes-zone">
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
              <ProjectorIcon
                name="chevron-right"
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
              shape="icon"
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
              <ProjectorIcon name="minus" v-if="group.staged" aria-hidden="true" /><ProjectorIcon
                name="plus"
                v-else
                aria-hidden="true"
              />
            </UiButton>
          </div>
          <GitChangesTree
            v-if="group.rows.length"
            v-show="!collapsedGroups.has(group.staged ? 'staged' : 'changed')"
            :key="`${projectId}:${group.staged}`"
            :changes="group.rows"
            :staged="group.staged"
            :project-id="projectId"
            :disabled="gitBusy"
            :can-toggle="
              (path) =>
                !!gitCommands.scope.describe(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                  path,
                })?.enabled
            "
            :selected="selected?.staged === group.staged ? selected.path : ''"
            :comment-count="(path) => commentCount(path, group.staged)"
            @change="
              gitCommands.run(group.staged ? 'ide.git.unstage' : 'ide.git.stage', {
                path: $event,
                staged: group.staged,
              })
            "
            @target="gitTarget = { path: $event, staged: group.staged }"
            @open="
              (path, pinned) =>
                gitCommands.run('ide.git.openDiff', { path, staged: group.staged, pinned })
            "
            @context="(event, path) => gitContext(event, path, group.staged)"
          />
        </template>
      </div>
      <GitSplitter
        v-if="historyOpen && writable"
        :target="historyZone"
        :stack="stack"
        @resize="historyHeight = $event"
        @collapse="historyOpen = false"
        @reset="gitCommands.run('ide.git.history.resize')"
      />
      <div ref="historyZone" class="history-zone" :style="historyStyle">
        <GitHistory
          v-model:open="historyOpen"
          v-model:target="commitTarget"
          :project-id="projectId"
          :history="history"
          :all-branches="gitProvider?.allBranches !== false"
          :snapshots="snapshots"
          :commands="gitCommands"
          :revision="overview.gutterRevision.value"
          @open-commit="emit('openCommit', $event)"
          @open-tree="emit('openCommitTree', $event)"
          @open-diff="(hash, path, pinned) => emit('openCommitDiff', hash, path, pinned)"
          @open-file="emit('open', $event)"
        />
      </div>
    </div>
    <ContextMenu ref="gitMenu" :items="gitMenuItems" label="Действия Git" />
  </UiScrollArea>
</template>

<style scoped>
/* Две зоны делят высоту панели: изменения и история прокручиваются каждая сама. */
.side-content.git-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.git-refresh {
  display: flex;
  justify-content: flex-end;
  padding: 4px var(--sp-2) 0;
}
.review-summary {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin: 4px var(--sp-2) 2px;
  padding: 2px 4px 2px var(--sp-2);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line));
  border-left: 2px solid var(--accent);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-2));
}
.review-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text);
}
.review-open:hover {
  color: var(--accent);
}
.review-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--accent);
}
.review-send {
  min-height: 24px;
  padding: 0 7px;
  gap: 4px;
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--text-2);
}
.review-send-icon {
  width: 12px;
  height: 12px;
}
.git-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.changes-zone {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}
.history-zone {
  min-height: 0;
  max-height: calc(100% - 96px);
  overflow: auto;
}
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
