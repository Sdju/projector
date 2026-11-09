<script setup lang="ts">
import UiAvatar from "../../common/ui/UiAvatar.vue";
import UiBadge from "../../common/ui/UiBadge.vue";
import UiCard from "../../common/ui/UiCard.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiInline from "../../common/ui/UiInline.vue";
import type { RepositoryOverviewModel, RepositoryStatIcon } from "./repository-overview.ts";
import { useTabReadout } from "../../common/utilities/tab-readout.ts";
import IconBranch from "~icons/lucide/git-branch";
import IconExternal from "~icons/lucide/external-link";
import IconEye from "~icons/lucide/eye";
import IconFork from "~icons/lucide/git-fork";
import IconGlobe from "~icons/lucide/globe";
import IconIssue from "~icons/lucide/circle-dot";
import IconMerge from "~icons/lucide/git-merge";
import IconScale from "~icons/lucide/scale";
import IconStar from "~icons/lucide/star";

const props = defineProps<{ repository: RepositoryOverviewModel }>();
const icons = {
  star: IconStar,
  fork: IconFork,
  eye: IconEye,
  issue: IconIssue,
  merge: IconMerge,
} satisfies Record<RepositoryStatIcon, unknown>;
const number = (value: number) => value.toLocaleString("ru-RU");
const visibility = () =>
  props.repository.visibility ?? (props.repository.private ? "приватный" : "публичный");
useTabReadout(() => props.repository.readout);
</script>

<template>
  <div class="repository-panel">
    <UiInline as="header" class="head" align="flex-start" :gap="3" justify="between" wrap>
      <UiInline class="identity" wrap justify="normal">
        <UiAvatar
          :src="repository.avatarUrl"
          :alt="repository.namespace || repository.fullName"
          :size="30"
        />
        <span v-if="repository.namespace" class="namespace">{{ repository.namespace }}/</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">{{
          repository.name
        }}</UiHeading>
        <UiBadge :tone="repository.private ? 'warning' : 'neutral'">{{ visibility() }}</UiBadge>
        <UiBadge v-if="repository.archived" tone="warning">в архиве</UiBadge>
        <UiBadge v-if="repository.empty">пустой</UiBadge>
      </UiInline>
      <UiInline
        as="a"
        inline
        justify="normal"
        class="repo-link"
        :href="repository.htmlUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <IconExternal aria-hidden="true" />Открыть на {{ repository.hostLabel }}
      </UiInline>
    </UiInline>

    <p v-if="repository.description" class="description">{{ repository.description }}</p>
    <p v-else class="description muted">Без описания</p>

    <ul v-if="repository.topics.length" class="topics">
      <li v-for="topic in repository.topics" :key="topic">{{ topic }}</li>
    </ul>

    <dl class="stats">
      <UiCard
        as="div"
        appearance="frame"
        v-for="item in repository.stats"
        :key="item.key"
        class="stat"
      >
        <dt><component :is="icons[item.icon]" aria-hidden="true" />{{ item.label }}</dt>
        <dd>{{ number(item.value) }}</dd>
      </UiCard>
    </dl>

    <dl class="details">
      <div v-for="item in repository.details" :key="item.key">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>

    <p v-if="repository.homepage" class="note-line">
      <IconGlobe aria-hidden="true" />
      <a :href="repository.homepage" target="_blank" rel="noopener noreferrer">
        {{ repository.homepage }}
      </a>
    </p>
    <p v-if="repository.refNote" class="note-line">
      <IconBranch aria-hidden="true" />{{ repository.refNote.text }}
      <code v-if="repository.refNote.code">{{ repository.refNote.code }}</code>
      <span v-if="repository.refNote.suffix">{{ repository.refNote.suffix }}</span>
    </p>
    <p v-if="repository.license" class="note-line">
      <IconScale aria-hidden="true" />Лицензия: {{ repository.license }}
    </p>
  </div>
</template>

<style scoped>
.repository-panel {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
  container-type: inline-size;
}
.identity {
  min-width: 0;
}
.namespace {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.repo-link {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: var(--fs-xs);
  text-decoration: none;
}
.repo-link:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.repo-link svg {
  width: 14px;
  height: 14px;
}
.description {
  margin: var(--sp-3) 0 0;
  max-width: 70ch;
  line-height: 1.5;
}
.muted {
  color: var(--muted);
}
.topics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: 0;
}
.topics li {
  padding: 2px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--active);
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-3);
  margin: var(--sp-4) 0 0;
}
.stat dt {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.stat dt svg {
  width: 13px;
  height: 13px;
}
.stat dd {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-lg);
  font-variant-numeric: tabular-nums;
}
.details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2) var(--sp-4);
  margin: var(--sp-4) 0 0;
}
.details div {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--line);
}
.details dt {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.details dd {
  margin: 0;
  font-size: var(--fs-xs);
  text-align: right;
  overflow-wrap: anywhere;
}
.note-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note-line svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.note-line a {
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.note-line a:hover {
  color: var(--text);
}
.note-line code {
  font-family: var(--mono);
}
@container (max-width: 560px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .details {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
