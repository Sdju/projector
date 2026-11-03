<script setup lang="ts">
import { computed } from "vue";
import IconGitBranch from "~icons/lucide/git-branch";
import UiBadge from "../../../../common/ui/UiBadge.vue";

interface GitCommit {
  hash: string;
  subject: string;
  author?: string;
  when?: string;
}

interface GitFile {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

const props = defineProps<{
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  clean?: boolean;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  conflicted?: number;
  additions?: number;
  deletions?: number;
  commits?: GitCommit[];
  files?: GitFile[];
}>();

const changes = computed(() =>
  [
    { label: "в индексе", value: props.staged },
    { label: "не в индексе", value: props.unstaged },
    { label: "неотслеживаемых", value: props.untracked },
    { label: "конфликтов", value: props.conflicted },
  ].filter((item): item is { label: string; value: number } => item.value !== undefined),
);
const changeCount = computed(() => changes.value.reduce((sum, item) => sum + item.value, 0));
const hasChanges = computed(() => changes.value.length > 0);
const diffTotal = computed(() => (props.additions ?? 0) + (props.deletions ?? 0));
const hasDiff = computed(() => props.additions !== undefined || props.deletions !== undefined);
const empty = computed(
  () =>
    !props.branch &&
    !props.upstream &&
    !hasChanges.value &&
    !hasDiff.value &&
    !props.commits?.length &&
    !props.files?.length &&
    props.clean === undefined,
);
const short = (hash: string) => hash.slice(0, 7);
</script>

<template>
  <section class="git-info">
    <p v-if="empty" class="muted">Нет данных git.</p>
    <template v-else>
      <header
        v-if="
          branch || upstream || ahead !== undefined || behind !== undefined || clean !== undefined
        "
      >
        <span v-if="branch" class="branch">
          <IconGitBranch aria-hidden="true" />
          <strong>{{ branch }}</strong>
        </span>
        <span v-if="upstream" class="upstream">{{ upstream }}</span>
        <UiBadge v-if="ahead" tone="info">↑{{ ahead }}</UiBadge>
        <UiBadge v-if="behind" tone="warning">↓{{ behind }}</UiBadge>
        <UiBadge
          v-if="clean === true || (clean !== false && hasChanges && changeCount === 0)"
          tone="info"
        >
          чисто
        </UiBadge>
        <UiBadge v-else-if="conflicted" tone="danger">{{ conflicted }} конфл.</UiBadge>
        <UiBadge v-else-if="hasChanges" tone="warning">{{ changeCount }} изм.</UiBadge>
      </header>

      <dl v-if="changes.length" class="metrics">
        <div v-for="item in changes" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>

      <div v-if="hasDiff" class="diff">
        <span class="add">+{{ additions ?? 0 }}</span>
        <span class="del">−{{ deletions ?? 0 }}</span>
        <span class="track" aria-hidden="true">
          <span
            v-if="diffTotal"
            class="added"
            :style="{ width: `${((additions ?? 0) / diffTotal) * 100}%` }"
          />
          <span
            v-if="diffTotal"
            class="deleted"
            :style="{ width: `${((deletions ?? 0) / diffTotal) * 100}%` }"
          />
        </span>
      </div>

      <ol v-if="commits?.length" class="commits">
        <li v-for="commit in commits" :key="commit.hash">
          <code>{{ short(commit.hash) }}</code>
          <span class="subject">{{ commit.subject }}</span>
          <span v-if="commit.author || commit.when" class="meta">
            {{ [commit.author, commit.when].filter(Boolean).join(" · ") }}
          </span>
        </li>
      </ol>

      <ul v-if="files?.length" class="files">
        <li v-for="file in files" :key="file.path">
          <UiBadge v-if="file.status" :tone="file.status === 'D' ? 'danger' : 'neutral'" mono>
            {{ file.status }}
          </UiBadge>
          <code class="path">{{ file.path }}</code>
          <span v-if="file.additions !== undefined" class="add">+{{ file.additions }}</span>
          <span v-if="file.deletions !== undefined" class="del">−{{ file.deletions }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.git-info {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: center;
}
.branch {
  display: inline-flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--text);
}
.branch svg {
  width: 14px;
  height: 14px;
}
.upstream,
.muted,
.meta {
  color: var(--muted);
}
.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-4);
  margin: 0;
}
.metrics div {
  display: grid;
  gap: 1px;
}
.metrics dt {
  font-size: var(--fs-2xs);
}
.metrics dd {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
}
.diff {
  display: grid;
  grid-template-columns: max-content max-content 1fr;
  gap: var(--sp-2);
  align-items: center;
  font-variant-numeric: tabular-nums;
}
.track {
  display: flex;
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-sm);
  background: var(--bg-3);
}
.track span {
  display: block;
  height: 100%;
}
.add {
  color: var(--run);
}
.del {
  color: var(--err);
}
.added {
  background: var(--run);
}
.deleted {
  background: var(--err);
}
.commits,
.files {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.commits li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--sp-2);
  align-items: baseline;
}
.commits code,
.path {
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
}
.commits .meta {
  grid-column: 2;
  font-size: var(--fs-2xs);
}
.subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files li {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  min-width: 0;
}
.path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files .add,
.files .del {
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
</style>
