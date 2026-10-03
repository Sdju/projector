<script setup lang="ts">
import { computed } from "vue";
import type { GitCommitDetail } from "../../../../../../core/modules/workspace/index.ts";
import { copyWithNotice } from "../../../../../common/utilities/notice.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import {
  absoluteTime,
  relativeTime,
  shortHash,
} from "../../../../../common/utilities/commit-format.ts";
import IconCopy from "~icons/lucide/copy";

/** Заголовок обзора коммита: описание, ссылки, хеш, автор, даты и родители. */
const props = defineProps<{ detail: GitCommitDetail }>();
const emit = defineEmits<{ openCommit: [hash: string] }>();
const sameCommitter = computed(() => props.detail.committer === props.detail.author);
async function copy(event: MouseEvent) {
  await copyWithNotice(event.currentTarget as Element, props.detail.hash, "Хеш скопирован");
}
</script>

<template>
  <div>
    <h2>{{ detail.subject || "(без описания)" }}</h2>
    <p class="refs" v-if="detail.refs.length">
      <span v-for="ref in detail.refs" :key="ref.kind + ref.name" class="ref" :class="ref.kind">
        {{ ref.name }}
      </span>
    </p>
    <pre v-if="detail.body" class="body">{{ detail.body }}</pre>
    <dl>
      <dt>Хеш</dt>
      <dd>
        <code>{{ detail.hash }}</code>
        <UiButton
          icon
          size="sm"
          title="Копировать хеш"
          aria-label="Копировать хеш"
          data-command="ide.git.commit.copyHash"
          @click="copy"
        >
          <IconCopy aria-hidden="true" />
        </UiButton>
      </dd>
      <dt>Автор</dt>
      <dd>
        {{ detail.author }} <span class="muted">&lt;{{ detail.email }}&gt;</span>
      </dd>
      <dt>Дата</dt>
      <dd>
        {{ absoluteTime(detail.date) }}
        <span class="muted">· {{ relativeTime(detail.date) }}</span>
      </dd>
      <template v-if="!sameCommitter">
        <dt>Коммит</dt>
        <dd>
          {{ detail.committer }}
          <span class="muted">· {{ absoluteTime(detail.committerDate) }}</span>
        </dd>
      </template>
      <dt>{{ detail.parents.length > 1 ? "Родители" : "Родитель" }}</dt>
      <dd>
        <span v-if="!detail.parents.length" class="muted">корневой коммит</span>
        <button
          v-for="parent in detail.parents"
          :key="parent"
          class="link"
          data-command="ide.git.commit.open"
          @click="emit('openCommit', parent)"
        >
          {{ shortHash(parent) }}
        </button>
      </dd>
    </dl>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg, 1.1rem);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 var(--sp-2);
}
.ref {
  padding: 0 6px;
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
.body {
  margin: 0 0 var(--sp-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--fs-xs) var(--mono);
  color: var(--text);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px var(--sp-3);
  margin: 0;
  font-size: var(--fs-xs);
}
dt {
  color: var(--faint);
}
dd {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  min-width: 0;
}
code {
  font: var(--fs-xs) var(--mono);
}
.muted {
  color: var(--muted);
}
.link {
  font: var(--fs-xs) var(--mono);
  color: var(--accent);
}
.link:hover {
  text-decoration: underline;
}
</style>
