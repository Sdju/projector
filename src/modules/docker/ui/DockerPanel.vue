<script setup lang="ts">
import { ref } from "vue";
import DockerBinding from "./DockerBinding.vue";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import { useDockerState } from "../model.ts";
const { snapshot, containers, current, selected, all, busy, error, commands } = useDockerState();
const shell = ref("sh");
const actions = [
  { id: "up", title: "Поднять" },
  { id: "composeStop", title: "Остановить" },
  { id: "composeRestart", title: "Перезапустить" },
  { id: "build", title: "Собрать" },
  { id: "pull", title: "Скачать образы" },
  { id: "down", title: "Удалить окружение" },
];
</script>
<template>
  <section
    class="docker-panel"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <header>
      <label
        >Окружение
        <select
          :value="snapshot?.context"
          :disabled="busy || !snapshot"
          @change="
            commands.run('ide.docker.context.select', {
              context: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option
            v-for="item in snapshot?.contexts"
            :key="item.name"
            :value="item.name"
            :disabled="!item.local"
          >
            {{ item.name }}{{ item.local ? "" : " · удалённый" }}
          </option>
        </select>
      </label>
      <UiButton :active="!all" @click="commands.run('ide.docker.open')">Проект</UiButton>
      <UiButton :active="all" @click="commands.run('ide.docker.open', { all: true })"
        >Все контейнеры</UiButton
      >
      <UiButton :disabled="busy" @click="commands.run('ide.docker.refresh')">Обновить</UiButton>
      <span class="muted">{{
        snapshot?.connected ? `Docker ${snapshot.version}` : "нет подключения"
      }}</span>
    </header>
    <p v-if="error || snapshot?.error" class="error" role="alert">{{ error || snapshot?.error }}</p>
    <UiEmpty v-if="!snapshot && !error">Подключение…</UiEmpty>
    <UiEmpty v-else-if="snapshot && !snapshot.enabled"
      >Docker выключен.
      <router-link to="/settings">Открыть настройки интеграций</router-link></UiEmpty
    >
    <template v-if="snapshot?.enabled">
      <DockerBinding v-if="!all" />
      <div v-if="!all && snapshot.binding" class="actions compose-actions">
        <UiButton
          v-for="action in actions"
          :key="action.id"
          size="sm"
          :disabled="!commands.scope.describe(`ide.docker.${action.id}`)?.enabled"
          @click="commands.run(`ide.docker.${action.id}`)"
          >{{ action.title }}</UiButton
        >
        <span v-if="snapshot.connected && !snapshot.composeVersion" class="error"
          >Docker Compose не установлен</span
        >
      </div>
      <UiEmpty v-if="snapshot.connected && !containers.length">{{
        !all && !snapshot.binding
          ? "Сохраните привязку или откройте все контейнеры."
          : "Контейнеров нет."
      }}</UiEmpty>
      <div v-if="containers.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Контейнер / сервис</th>
              <th>Состояние</th>
              <th>Health</th>
              <th>Образ</th>
              <th>Порты</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in containers"
              :key="item.id"
              :class="{ selected: selected === item.id }"
            >
              <td>
                <button
                  class="select-container"
                  @click="commands.run('ide.docker.container.select', { containerId: item.id })"
                >
                  {{ item.service || item.name }}</button
                ><small>{{ item.project || "отдельный контейнер" }} · {{ item.name }}</small>
              </td>
              <td :class="{ failed: item.state === 'exited' && item.exitCode !== 0 }">
                {{ item.state }}{{ item.state === "exited" ? ` · ${item.exitCode}` : "" }}
              </td>
              <td :class="{ failed: item.health === 'unhealthy' }">
                {{ item.health || "не задан" }}
              </td>
              <td>{{ item.image }}</td>
              <td>
                {{
                  item.ports
                    .map((port) => `${port.publicPort} → ${port.privatePort}/${port.protocol}`)
                    .join(", ") || "—"
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <article v-if="current" class="details">
        <h3>{{ current.name }}</h3>
        <p class="muted">
          {{ current.id.slice(0, 12) }} · {{ current.image }} ·
          {{ absoluteTime(current.startedAt) }}
        </p>
        <div class="actions">
          <UiButton
            v-if="current.state !== 'running'"
            :disabled="busy || !snapshot.connected"
            @click="commands.run('ide.docker.start')"
            >Запустить</UiButton
          >
          <UiButton
            v-if="current.state === 'running'"
            :disabled="busy || !snapshot.connected"
            @click="commands.run('ide.docker.stop')"
            >Остановить</UiButton
          >
          <UiButton
            :disabled="busy || !snapshot.connected"
            @click="commands.run('ide.docker.restart')"
            >Перезапустить</UiButton
          >
          <UiButton :disabled="busy || !snapshot.connected" @click="commands.run('ide.docker.logs')"
            >Логи</UiButton
          >
          <select v-model="shell" aria-label="Оболочка контейнера">
            <option>sh</option>
            <option>bash</option>
          </select>
          <UiButton
            :disabled="busy || current.state !== 'running' || !snapshot.connected"
            @click="commands.run('ide.docker.shell', { shell })"
            >Shell</UiButton
          >
          <UiButton
            :disabled="busy || current.state === 'running' || !snapshot.connected"
            @click="commands.run('ide.docker.remove')"
            >Удалить</UiButton
          >
        </div>
        <div v-if="current.ports.length" class="ports">
          <div
            v-for="port in current.ports"
            :key="`${port.address}:${port.publicPort}/${port.protocol}`"
          >
            <code
              >{{ port.address }}:{{ port.publicPort }} → {{ port.privatePort }}/{{
                port.protocol
              }}</code
            >
            <template v-if="port.url"
              ><UiButton
                size="sm"
                @click="commands.run('ide.docker.port.open', { port: port.publicPort })"
                >HTTP ↗</UiButton
              ><UiButton
                size="sm"
                @click="
                  commands.run('ide.docker.port.open', { port: port.publicPort, scheme: 'https' })
                "
                >HTTPS ↗</UiButton
              ></template
            >
          </div>
        </div>
        <dl v-if="current.mounts.length">
          <template v-for="mount in current.mounts" :key="mount.target"
            ><dt>{{ mount.target }} · {{ mount.type }} · {{ mount.writable ? "rw" : "ro" }}</dt>
            <dd>{{ mount.source }}</dd></template
          >
        </dl>
      </article>
    </template>
  </section>
</template>
<style scoped>
.docker-panel {
  height: 100%;
  overflow: auto;
  font-size: var(--fs-xs);
}
header,
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
header {
  padding: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
header label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.muted,
small {
  color: var(--muted);
}
.error,
.failed {
  color: var(--err);
}
.error {
  margin: 0;
  padding: var(--sp-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
input,
select,
textarea {
  background: var(--bg-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: var(--r-sm);
  padding: var(--sp-2);
  min-width: 0;
}
select {
  width: auto;
  padding-right: 28px;
}
.compose-actions {
  padding: var(--sp-3);
}
.table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th,
td {
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
th {
  color: var(--muted);
  font-weight: 400;
}
tr.selected {
  background: var(--bg-2);
}
.select-container {
  text-align: left;
  color: var(--text);
}
.select-container:hover {
  color: var(--focus);
}
small {
  display: block;
  margin-top: 4px;
  font-size: var(--fs-2xs);
}
.details {
  padding: var(--sp-3);
}
.details h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
}
.ports {
  margin-top: var(--sp-3);
}
.ports > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  padding-block: var(--sp-1);
}
dl {
  font-family: var(--mono);
  overflow-wrap: anywhere;
}
dt {
  color: var(--muted);
  margin-top: var(--sp-2);
}
dd {
  margin: 4px 0 0;
}
</style>
