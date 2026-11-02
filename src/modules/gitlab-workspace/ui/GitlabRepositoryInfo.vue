<script setup lang="ts">
import UiCard from "../../../common/ui/UiCard.vue";
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import { computed } from "vue";
import type { GitlabRepository } from "../../../../core/modules/gitlab/index.ts";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiAvatar from "../../../common/ui/UiAvatar.vue";
import IconStar from "~icons/lucide/star";
import IconFork from "~icons/lucide/git-fork";
import IconIssue from "~icons/lucide/circle-dot";
import IconMerge from "~icons/lucide/git-merge";
import IconBranch from "~icons/lucide/git-branch";
import IconScale from "~icons/lucide/scale";
import IconExternal from "~icons/lucide/external-link";

const props = defineProps<{ repository: GitlabRepository }>();
const number = (value: number) => value.toLocaleString("ru-RU");
const name = computed(
  () => props.repository.fullName.split("/").at(-1) ?? props.repository.fullName,
);
const namespace = computed(() => props.repository.fullName.split("/").slice(0, -1).join("/"));
const languages = computed(() =>
  Object.entries(props.repository.languages ?? {})
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([language]) => language),
);
const stats = computed(() => [
  { key: "stars", label: "Звёзды", value: props.repository.stars, icon: IconStar },
  { key: "forks", label: "Форки", value: props.repository.forks, icon: IconFork },
  { key: "issues", label: "Открытые issues", value: props.repository.openIssues, icon: IconIssue },
  {
    key: "mergeRequests",
    label: "Открытые MR",
    value: props.repository.openMergeRequests,
    icon: IconMerge,
  },
]);
const details = computed(() => [
  {
    key: "languages",
    label: "Языки",
    value: languages.value.length ? languages.value.slice(0, 4).join(", ") : "—",
  },
  { key: "license", label: "Лицензия", value: props.repository.license || "—" },
  {
    key: "defaultBranch",
    label: "Ветка по умолчанию",
    value: props.repository.defaultBranch || "—",
  },
  {
    key: "ref",
    label: "Открытая ветка",
    value: props.repository.empty
      ? "пустой проект"
      : `${props.repository.branch}${props.repository.commit ? ` · ${props.repository.commit.slice(0, 7)}` : ""}`,
  },
  { key: "created", label: "Создан", value: absoluteTime(props.repository.createdAt) || "—" },
  { key: "updated", label: "Обновлён", value: absoluteTime(props.repository.updatedAt) || "—" },
]);
const refLabel = computed(() =>
  props.repository.empty ? "Проект без коммитов" : props.repository.branch || "ветка не выбрана",
);

// Что штатный агент видит во вкладке «О проекте»: метаданные GitLab без оформления.
useTabReadout(() => {
  const repo = props.repository;
  if (!repo) return undefined;
  return {
    note: "О проекте",
    text: readoutLines(
      `Проект ${repo.fullName}`,
      repo.description ? `Описание: ${repo.description}` : "Без описания",
      languages.value.length ? `Языки: ${languages.value.join(", ")}` : "",
      repo.visibility ? `Видимость: ${repo.visibility}` : "",
      `Звёзды: ${repo.stars}, форки: ${repo.forks}, открытые issues: ${repo.openIssues}, открытые MR: ${repo.openMergeRequests}`,
      `Ветка по умолчанию: ${repo.defaultBranch || "—"}`,
      repo.license ? `Лицензия: ${repo.license}` : "",
      repo.topics.length ? `Темы: ${repo.topics.join(", ")}` : "",
      `URL: ${repo.webUrl}`,
    ),
  };
});
</script>

<template>
  <div class="repository-panel">
    <UiInline as="header" class="head" align="flex-start" :gap="3" justify="between" wrap>
      <UiInline class="identity" wrap justify="normal">
        <UiAvatar :src="repository.avatarUrl" :alt="namespace || repository.fullName" :size="30" />
        <span v-if="namespace" class="namespace">{{ namespace }}/</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">{{ name }}</UiHeading>
        <UiBadge :tone="repository.private ? 'warning' : 'neutral'">
          {{ repository.visibility || (repository.private ? "приватный" : "публичный") }}
        </UiBadge>
        <UiBadge v-if="repository.archived" tone="warning">в архиве</UiBadge>
        <UiBadge v-if="repository.empty">пустой</UiBadge>
      </UiInline>
      <UiInline
        v-if="repository.webUrl"
        as="a"
        inline
        justify="normal"
        class="gitlab-link"
        :href="repository.webUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <IconExternal aria-hidden="true" />Открыть на GitLab
      </UiInline>
    </UiInline>

    <p v-if="repository.description" class="description">{{ repository.description }}</p>
    <UiHint v-else size="sm" wrap>Без описания</UiHint>

    <ul v-if="repository.topics.length" class="topics">
      <li v-for="topic in repository.topics" :key="topic">{{ topic }}</li>
    </ul>

    <dl class="stats">
      <UiCard as="div" appearance="frame" v-for="item in stats" :key="item.key" class="stat">
        <dt><component :is="item.icon" aria-hidden="true" />{{ item.label }}</dt>
        <dd>{{ number(item.value) }}</dd>
      </UiCard>
    </dl>

    <dl class="details">
      <div v-for="item in details" :key="item.key">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>

    <UiHint v-if="!repository.empty" size="xs" wrap class="ref-note">
      <IconBranch aria-hidden="true" />Дерево и история привязаны к снимку
      <code>{{ repository.commit.slice(0, 7) }}</code
      >, ветка {{ refLabel }}.
    </UiHint>
    <UiHint v-else size="xs" wrap class="ref-note">
      <IconBranch aria-hidden="true" />{{ refLabel }}.
    </UiHint>
    <UiHint v-if="repository.license" size="xs" wrap class="license-note">
      <IconScale aria-hidden="true" />Лицензия: {{ repository.license }}
    </UiHint>
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
.gitlab-link {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: var(--fs-xs);
  text-decoration: none;
}
.gitlab-link:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.gitlab-link svg {
  width: 14px;
  height: 14px;
}
.description {
  margin: var(--sp-3) 0 0;
  max-width: 70ch;
  line-height: 1.5;
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
.ref-note,
.license-note {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.ref-note svg,
.license-note svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.ref-note code {
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
