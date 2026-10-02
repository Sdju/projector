<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { useProjects } from "../catalog/index.ts";
import type { Project } from "../catalog/index.ts";
import { fetchIntegrations, integrationRequest } from "./client.ts";
import type { Integration, Repository } from "./client.ts";
const github = ref<Integration | null>(null);
const opened = ref(false);
const repos = ref<Repository[]>([]);
const query = ref("");
const repository = ref("");
const page = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const importing = ref("");
const error = ref("");
const message = ref("");
const projects = useProjects();
const visible = computed(() =>
  repos.value.filter((repo) => repo.fullName.toLowerCase().includes(query.value.toLowerCase())),
);
async function refreshStatus() {
  const data = await fetchIntegrations();
  github.value = data.integrations.find((item) => item.id === "github") ?? null;
}
onMounted(() =>
  refreshStatus().catch((err) => {
    error.value = err.message;
  }),
);
async function loadMore() {
  loading.value = true;
  error.value = "";
  try {
    const data = await integrationRequest<{
      repositories: Repository[];
      page: number;
      hasMore: boolean;
    }>(`/github/repositories?page=${page.value + 1}`);
    repos.value.push(...data.repositories);
    page.value = data.page;
    hasMore.value = data.hasMore;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Ошибка загрузки";
  } finally {
    loading.value = false;
  }
}
async function toggle() {
  opened.value = !opened.value;
  if (opened.value) {
    try {
      await refreshStatus();
      if (github.value?.enabled && github.value.connected && !page.value) await loadMore();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка интеграции";
    }
  }
}
async function importRepo(name: string) {
  importing.value = name;
  error.value = "";
  message.value = "";
  try {
    const data = await integrationRequest<{ project: Project }>("/github/import", "POST", {
      repository: name,
    });
    projects.ingest(data.project);
    message.value = `Добавлен ${data.project.name} · ${data.project.path}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Ошибка импорта";
  } finally {
    importing.value = "";
  }
}
</script>

<template>
  <section class="github-import">
    <UiButton :active="opened" @click="toggle">импорт из GitHub</UiButton>
    <div v-if="opened" class="panel">
      <template v-if="github?.enabled && github.connected">
        <p class="muted">{{ github.account }} · папка {{ github.settings.directory }}</p>
        <form @submit.prevent="importRepo(repository)">
          <input
            v-model="repository"
            aria-label="Репозиторий GitHub"
            placeholder="owner/repository или ссылка GitHub"
            required
            :disabled="!!importing"
          />
          <UiButton type="submit" :disabled="!!importing || !repository.trim()"
            >импортировать</UiButton
          >
        </form>
        <input
          v-model="query"
          aria-label="Фильтр репозиториев"
          placeholder="Найти среди загруженных репозиториев"
          class="filter"
        />
        <div v-for="repo in visible" :key="repo.fullName" class="repo">
          <div>
            <a :href="repo.url" target="_blank" rel="noopener noreferrer">{{ repo.fullName }}</a
            ><span v-if="repo.private" class="private">приватный</span>
            <p v-if="repo.description" class="description">{{ repo.description }}</p>
          </div>
          <UiButton :disabled="!!importing" @click="importRepo(repo.fullName)">импорт</UiButton>
        </div>
        <p v-if="loading" class="muted" role="status">Загружаем репозитории…</p>
        <p v-else-if="!visible.length" class="muted">
          Нет репозиториев по этому запросу. Можно вставить ссылку выше.
        </p>
        <UiButton v-if="hasMore" :disabled="loading || !!importing" @click="loadMore"
          >загрузить ещё</UiButton
        >
        <p v-if="importing" class="muted" role="status">Клонируем {{ importing }}…</p>
      </template>
      <p v-else class="muted">
        Для импорта
        <router-link to="/settings">включите GitHub и войдите в аккаунт в настройках</router-link>.
      </p>
      <p v-if="message" class="muted" role="status">{{ message }}</p>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.github-import {
  margin: 0 0 24px;
}
.panel {
  border: 1px solid var(--line);
  padding: 16px;
  margin-top: 12px;
  border-radius: 4px;
}
.muted,
.description,
.private {
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
form {
  display: flex;
  gap: 8px;
}
form input {
  min-width: 0;
}
form button {
  flex-shrink: 0;
}
.filter {
  margin: 16px 0 8px;
}
.repo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 12px 0;
}
.repo > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.description {
  margin: 4px 0 0;
}
.private {
  margin-left: 8px;
}
a {
  text-decoration: underline;
}
.error {
  color: var(--err);
}
</style>
