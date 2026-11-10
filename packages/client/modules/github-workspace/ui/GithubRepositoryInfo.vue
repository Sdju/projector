<script setup lang="ts">
import { computed } from "vue";
import type { GithubRepository } from "@ai-projector/core/modules/github/index.ts";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import { readoutLines } from "../../../common/utilities/tab-readout.ts";
import { RepositoryOverview, type RepositoryOverviewModel } from "../../integration-api/index.ts";

const props = withDefaults(defineProps<{ repository: GithubRepository; snapshot?: boolean }>(), {
  snapshot: true,
});
const model = computed<RepositoryOverviewModel>(() => {
  const repo = props.repository;
  const name = repo.fullName.split("/").at(-1) ?? repo.fullName;
  return {
    name,
    namespace: repo.owner || repo.fullName.split("/")[0],
    fullName: repo.fullName,
    avatarUrl: repo.avatarUrl,
    description: repo.description,
    private: repo.private,
    htmlUrl: repo.htmlUrl,
    hostLabel: "GitHub",
    topics: repo.topics,
    stats: [
      { key: "stars", label: "Звёзды", value: repo.stars, icon: "star" },
      { key: "forks", label: "Форки", value: repo.forks, icon: "fork" },
      { key: "watchers", label: "Наблюдатели", value: repo.watchers, icon: "eye" },
      { key: "issues", label: "Открытые issues", value: repo.openIssues, icon: "issue" },
    ],
    details: [
      { key: "language", label: "Язык", value: repo.language || "—" },
      { key: "license", label: "Лицензия", value: repo.license || "—" },
      { key: "defaultBranch", label: "Ветка по умолчанию", value: repo.defaultBranch || "—" },
      {
        key: "ref",
        label: "Открытый ref",
        value: repo.empty
          ? "пустой репозиторий"
          : `${repo.branch}${repo.commit ? ` · ${repo.commit.slice(0, 7)}` : ""}`,
      },
      { key: "created", label: "Создан", value: absoluteTime(repo.createdAt) || "—" },
      { key: "updated", label: "Обновлён", value: absoluteTime(repo.updatedAt) || "—" },
    ],
    homepage: repo.homepage || undefined,
    license: repo.license || undefined,
    refNote:
      props.snapshot && !repo.empty
        ? { text: "Дерево и история привязаны к снимку", code: repo.tree.slice(0, 7) }
        : undefined,
    readout: {
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
    },
  };
});
</script>

<template>
  <RepositoryOverview :repository="model" />
</template>
