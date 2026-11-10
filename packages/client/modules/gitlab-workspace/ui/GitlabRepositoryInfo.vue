<script setup lang="ts">
import { computed } from "vue";
import type { GitlabRepository } from "@ai-projector/core/modules/gitlab/index.ts";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import { readoutLines } from "../../../common/utilities/tab-readout.ts";
import { RepositoryOverview, type RepositoryOverviewModel } from "../../integration-api/index.ts";

const props = defineProps<{ repository: GitlabRepository }>();
const languages = computed(() =>
  Object.entries(props.repository.languages ?? {})
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([language]) => language),
);
const model = computed<RepositoryOverviewModel>(() => {
  const repo = props.repository;
  const name = repo.fullName.split("/").at(-1) ?? repo.fullName;
  const refLabel = repo.empty ? "Проект без коммитов" : repo.branch || "ветка не выбрана";
  return {
    name,
    namespace: repo.fullName.split("/").slice(0, -1).join("/"),
    fullName: repo.fullName,
    avatarUrl: repo.avatarUrl,
    description: repo.description,
    private: repo.private,
    visibility: repo.visibility || (repo.private ? "приватный" : "публичный"),
    archived: repo.archived,
    empty: repo.empty,
    htmlUrl: repo.webUrl,
    hostLabel: "GitLab",
    topics: repo.topics,
    stats: [
      { key: "stars", label: "Звёзды", value: repo.stars, icon: "star" },
      { key: "forks", label: "Форки", value: repo.forks, icon: "fork" },
      { key: "issues", label: "Открытые issues", value: repo.openIssues, icon: "issue" },
      { key: "mergeRequests", label: "Открытые MR", value: repo.openMergeRequests, icon: "merge" },
    ],
    details: [
      {
        key: "languages",
        label: "Языки",
        value: languages.value.length ? languages.value.slice(0, 4).join(", ") : "—",
      },
      { key: "license", label: "Лицензия", value: repo.license || "—" },
      { key: "defaultBranch", label: "Ветка по умолчанию", value: repo.defaultBranch || "—" },
      {
        key: "ref",
        label: "Открытая ветка",
        value: repo.empty
          ? "пустой проект"
          : `${repo.branch}${repo.commit ? ` · ${repo.commit.slice(0, 7)}` : ""}`,
      },
      { key: "created", label: "Создан", value: absoluteTime(repo.createdAt) || "—" },
      { key: "updated", label: "Обновлён", value: absoluteTime(repo.updatedAt) || "—" },
    ],
    license: repo.license || undefined,
    refNote: repo.empty
      ? { text: `${refLabel}.` }
      : {
          text: "Дерево и история привязаны к снимку",
          code: repo.commit.slice(0, 7),
          suffix: `, ветка ${refLabel}.`,
        },
    readout: {
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
    },
  };
});
</script>

<template>
  <RepositoryOverview :repository="model" />
</template>
