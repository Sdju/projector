<script setup lang="ts">
import { computed } from "vue";
import type {
  GitCommit,
  GitOverview,
  GraphRow,
} from "../../../../core/modules/workspace/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { absoluteTime, relativeTime, shortHash } from "../lib/commit-format.ts";
import type { CommitDetailState } from "../lib/git-history.ts";
import GitChangesTree from "./GitChangesTree.vue";
import GitGraphCell from "./GitGraphCell.vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconOpen from "~icons/lucide/external-link";
import IconCopy from "~icons/lucide/copy";

const props = defineProps<{
  commit: GitCommit;
  row: GraphRow;
  columns: number;
  expanded: boolean;
  state?: CommitDetailState;
  /** Почта автора репозитория: свои коммиты не подписываются. */
  me: string;
  now: number;
}>();
const emit = defineEmits<{
  toggle: [];
  open: [];
  copy: [];
  openDiff: [path: string, pinned?: boolean];
  context: [event: MouseEvent | KeyboardEvent, path: string];
  target: [path: string];
}>();
const ROW = 40;
const GUTTER_STEP = 10;
const gutter = computed(() => ({ width: `${14 + (props.columns - 1) * GUTTER_STEP}px` }));
const lanes = computed(() =>
  [...new Set([...props.row.through, ...props.row.forks])].map((column) => ({
    column,
    left: `${6.25 + Math.min(column, props.columns - 1) * GUTTER_STEP}px`,
  })),
);
const changes = computed<GitOverview["changes"]>(
  () =>
    props.state?.detail?.files.map((file) => ({
      path: file.path,
      originalPath: file.originalPath,
      index: file.status,
      worktree: " ",
    })) ?? [],
);
const merge = computed(() => props.commit.parents.length > 1);
const ownCommit = computed(() => !!props.me && props.commit.email === props.me);
const refs = computed(() => props.commit.refs.filter((ref) => ref.name !== "HEAD" || props.commit.refs.length === 1));
</script>

<template>
  <li class="commit" :class="{ expanded }" :data-hash="commit.hash">
    <div class="head">
      <button
        class="row"
        :style="{ height: `${ROW}px` }"
        :aria-expanded="expanded"
        :title="`${commit.subject}\n${commit.author} <${commit.email}>\n${absoluteTime(commit.date)}\n${commit.hash}`"
        @click="emit('toggle')"
        @focus="emit('target', '')"
        @contextmenu="emit('context', $event, '')"
        @keydown.shift.f10.prevent="emit('context', $event, '')"
      >
        <GitGraphCell
          :row="row"
          :columns="columns"
          :height="ROW"
          :hollow="commit.unpushed"
          :merge="merge"
        />
        <span class="text">
          <span class="line">
            <span class="subject">{{ commit.subject || "(без описания)" }}</span>
            <span
              v-for="ref in refs"
              :key="ref.kind + ref.name"
              class="ref"
              :class="ref.kind"
              >{{ ref.name }}</span
            >
          </span>
          <span class="meta">
            <span v-if="!ownCommit" class="author">{{ commit.author }}</span>
            <span>{{ relativeTime(commit.date, now) }}</span>
            <code>{{ shortHash(commit.hash) }}</code>
            <span v-if="commit.unpushed" class="flag" title="Ещё не отправлен в upstream">↑</span>
            <span v-if="merge" class="flag">merge</span>
          </span>
        </span>
        <IconChevronRight class="chevron" :class="{ open: expanded }" aria-hidden="true" />
      </button>
      <UiButton
        icon
        size="sm"
        class="open"
        title="Открыть обзор коммита"
        aria-label="Открыть обзор коммита"
        data-command="ide.git.commit.open"
        @click="emit('open')"
      >
        <IconOpen aria-hidden="true" />
      </UiButton>
    </div>
    <div v-if="expanded" class="details" :style="{ paddingLeft: gutter.width }">
      <i v-for="lane in lanes" :key="lane.column" class="lane" :style="{ left: lane.left }" />
      <p v-if="state?.loading && !state.detail" class="note" role="status">загрузка…</p>
      <p v-else-if="state?.error" class="note error" role="alert">{{ state.error }}</p>
      <template v-else-if="state?.detail">
        <pre v-if="state.detail.body" class="body">{{ state.detail.body }}</pre>
        <div class="summary">
          <span>
            {{ state.detail.files.length }} файл.
            <b class="add">+{{ state.detail.additions }}</b>
            <b class="del">−{{ state.detail.deletions }}</b>
          </span>
          <UiButton
            icon
            size="sm"
            title="Копировать хеш"
            aria-label="Копировать хеш"
            data-command="ide.git.commit.copyHash"
            @click="emit('copy')"
          >
            <IconCopy aria-hidden="true" />
          </UiButton>
        </div>
        <p v-if="!changes.length" class="note">В этой папке коммит ничего не менял.</p>
        <GitChangesTree
          v-else
          :changes="changes"
          staged
          readonly
          :label="`Изменения коммита ${shortHash(commit.hash)}`"
          selected=""
          @open="(path, pinned) => emit('openDiff', path, pinned)"
          @target="emit('target', $event)"
          @context="(event, path) => emit('context', event, path)"
        />
      </template>
    </div>
  </li>
</template>

<style scoped>
.commit {
  position: relative;
}
.head {
  display: flex;
  align-items: center;
  padding-right: 8px;
}
.head:hover,
.head:focus-within {
  background: var(--hover);
}
.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 0 var(--sp-2);
  text-align: left;
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.line,
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}
.subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-xs);
  color: var(--text);
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--faint);
  overflow: hidden;
}
.author {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}
.meta code {
  font: var(--fs-2xs) var(--mono);
}
.flag {
  color: var(--warn);
}
.ref {
  flex-shrink: 0;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.ref.head,
.ref.branch {
  color: var(--run);
}
.ref.tag {
  color: var(--accent);
}
.chevron {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  color: var(--faint);
}
.chevron.open {
  transform: rotate(90deg);
}
.open {
  opacity: 0;
}
.head:hover .open,
.head:focus-within .open {
  opacity: 1;
}
@media (hover: none) {
  .open {
    opacity: 1;
  }
}
.details {
  position: relative;
  padding-right: 4px;
  padding-bottom: var(--sp-2);
}
.lane {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--line);
}
.body {
  margin: 0 0 var(--sp-2);
  padding: 0 var(--sp-2);
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-2);
  font-size: var(--fs-2xs);
  color: var(--muted);
}
.add {
  margin-left: 6px;
  color: var(--run);
  font-weight: 500;
}
.del {
  margin-left: 4px;
  color: var(--err);
  font-weight: 500;
}
.note {
  margin: 0;
  padding: 2px var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--muted);
}
.error {
  color: var(--err);
}
</style>
