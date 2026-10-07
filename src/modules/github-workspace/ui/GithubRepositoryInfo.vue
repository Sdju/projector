<script setup lang="ts">
import { computed } from "vue";
import type { GithubRepository } from "../../../../core/modules/github/index.ts";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiAvatar from "../../../common/ui/UiAvatar.vue";
import IconStar from "~icons/lucide/star";
import IconFork from "~icons/lucide/git-fork";
import IconEye from "~icons/lucide/eye";
import IconIssue from "~icons/lucide/circle-dot";
import IconBranch from "~icons/lucide/git-branch";
import IconScale from "~icons/lucide/scale";
import IconGlobe from "~icons/lucide/globe";
import IconExternal from "~icons/lucide/external-link";

const props = withDefaults(defineProps<{ repository: GithubRepository; snapshot?: boolean }>(), {
  snapshot: true,
});
const number = (value: number) => value.toLocaleString("ru-RU");
const stats = computed(() => [
  { key: "stars", label: "Звёзды", value: props.repository.stars, icon: IconStar },
  { key: "forks", label: "Форки", value: props.repository.forks, icon: IconFork },
  { key: "watchers", label: "Наблюдатели", value: props.repository.watchers, icon: IconEye },
  { key: "issues", label: "Открытые issues", value: props.repository.openIssues, icon: IconIssue },
]);
const details = computed(() => [
  { key: "language", label: "Язык", value: props.repository.language || "—" },
  { key: "license", label: "Лицензия", value: props.repository.license || "—" },
  {
    key: "defaultBranch",
    label: "Ветка по умолчанию",
    value: props.repository.defaultBranch || "—",
  },
  {
    key: "ref",
    label: "Открытый ref",
    value: props.repository.empty
      ? "пустой репозиторий"
      : `${props.repository.branch}${props.repository.commit ? ` · ${props.repository.commit.slice(0, 7)}` : ""}`,
  },
  { key: "created", label: "Создан", value: absoluteTime(props.repository.createdAt) || "—" },
  { key: "updated", label: "Обновлён", value: absoluteTime(props.repository.updatedAt) || "—" },
]);
// Что штатный агент видит во вкладке «О репозитории»: метаданные GitHub без значений оформления.
useTabReadout(() => {
  const repo = props.repository;
  if (!repo) return undefined;
  return {
    note: "О репозитории",
    text: readoutLines(
      `Репозиторий ${repo.fullName}`,
      repo.description ? `Описание: ${repo.description}` : "Без описания",
      repo.language ? `Язык: ${repo.language}` : "",
      repo.private ? "Приватный" : "Публичный",
      `Звёзды: ${repo.stars}, форки: ${repo.forks}, наблюдатели: ${repo.watchers}, открытые issues: ${repo.openIssues}`,
      `Ветка по умолчанию: ${repo.defaultBranch || "—"}`,
      repo.license ? `Лицензия: ${repo.license}` : "",
      repo.topics.length ? `Темы: ${repo.topics.join(", ")}` : "",
      `URL: ${repo.htmlUrl}`,
    ),
  };
});
</script>

<template>
  <div class="repository-panel">
    <header class="head">
      <div class="identity">
        <UiAvatar
          :src="repository.avatarUrl"
          :alt="repository.owner || repository.fullName"
          :size="30"
        />
        <span class="owner">{{ repository.owner || repository.fullName.split("/")[0] }}/</span>
        <h2>{{ repository.fullName.split("/").at(-1) }}</h2>
        <span class="visibility" :class="{ private: repository.private }">
          {{ repository.private ? "приватный" : "публичный" }}
        </span>
      </div>
      <a class="github-link" :href="repository.htmlUrl" target="_blank" rel="noopener noreferrer">
        <IconExternal aria-hidden="true" />Открыть на GitHub
      </a>
    </header>

    <p v-if="repository.description" class="description">{{ repository.description }}</p>
    <p v-else class="description muted">Без описания</p>

    <ul v-if="repository.topics.length" class="topics">
      <li v-for="topic in repository.topics" :key="topic">{{ topic }}</li>
    </ul>

    <dl class="stats">
      <div v-for="item in stats" :key="item.key" class="stat">
        <dt><component :is="item.icon" aria-hidden="true" />{{ item.label }}</dt>
        <dd>{{ number(item.value) }}</dd>
      </div>
    </dl>

    <dl class="details">
      <div v-for="item in details" :key="item.key">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>

    <p v-if="repository.homepage" class="homepage">
      <IconGlobe aria-hidden="true" />
      <a :href="repository.homepage" target="_blank" rel="noopener noreferrer">
        {{ repository.homepage }}
      </a>
    </p>
    <p v-if="snapshot && !repository.empty" class="ref-note">
      <IconBranch aria-hidden="true" />Дерево и история привязаны к снимку
      <code>{{ repository.tree.slice(0, 7) }}</code>
    </p>
    <p v-if="repository.license" class="license-note">
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
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.identity {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  min-width: 0;
}
.owner {
  color: var(--muted);
  font-size: var(--fs-sm);
}
h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}
.visibility {
  padding: 1px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.visibility.private {
  border-color: var(--warn, var(--line));
  color: var(--warn, var(--muted));
}
.github-link {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: var(--fs-xs);
  text-decoration: none;
}
.github-link:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.github-link svg {
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
.stat {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
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
.homepage,
.ref-note,
.license-note {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.homepage svg,
.ref-note svg,
.license-note svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.homepage a {
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.homepage a:hover {
  color: var(--text);
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
