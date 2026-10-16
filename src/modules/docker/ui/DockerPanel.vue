<script setup lang="ts">
import DockerDaemonNotice from "./DockerDaemonNotice.vue";
import UiTable from "../../../common/ui/UiTable.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { ref } from "vue";
import type { DockerContainer } from "../../../../core/modules/docker/index.ts";
import DockerBinding from "./DockerBinding.vue";
import { absoluteTime } from "../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import { useDockerState } from "../model.ts";
const { snapshot, containers, current, selected, all, busy, starting, error, commands } =
  useDockerState();
const shell = ref("sh");
const portsOf = (item: DockerContainer) =>
  item.ports.map((port) => `${port.publicPort}→${port.privatePort}/${port.protocol}`).join(", ") ||
  "—";
// Что штатный агент видит на вкладке Docker: подключение, фильтр, контейнеры и выбранный контейнер.
useTabReadout(() => {
  const data = snapshot.value;
  const binding = data?.binding;
  const items = containers.value;
  const details = current.value;
  const problem = error.value || data?.error || "";
  return {
    note: "Docker",
    text: readoutLines(
      data?.connected ? `Подключение: Docker ${data.version}` : "Подключение: нет",
      data ? `Контекст: ${data.context}` : undefined,
      data?.contexts.length
        ? `Контексты: ${data.contexts.map((item) => item.name).join(", ")}`
        : undefined,
      data && !data.enabled ? "Docker выключен" : undefined,
      all.value ? "Показаны: все контейнеры" : "Показаны: контейнеры проекта",
      binding
        ? `Привязка: ${binding.name}${binding.files.length ? ` · ${binding.files.join(", ")}` : ""}${binding.profiles.length ? ` · profiles ${binding.profiles.join(", ")}` : ""}`
        : undefined,
      problem ? `Ошибка: ${problem}` : undefined,
      busy.value ? "Выполняется действие…" : undefined,
      items.length
        ? `Контейнеры:\n${items
            .map(
              (item) =>
                `${item.service || item.name} — ${item.state}${item.state === "exited" ? ` (${item.exitCode})` : ""}, health ${item.health || "—"}, ${item.image}, ports ${portsOf(item)}`,
            )
            .join("\n")}`
        : "Контейнеры: нет",
      details
        ? readoutLines(
            `Выбран: ${details.name} (${details.id.slice(0, 12)}) · ${details.image} · ${absoluteTime(details.startedAt)}`,
            `Порты: ${portsOf(details)}`,
            details.mounts.length
              ? `Монтирования:\n${details.mounts
                  .map(
                    (mount) =>
                      `${mount.target} · ${mount.type} · ${mount.writable ? "rw" : "ro"} ← ${mount.source}`,
                  )
                  .join("\n")}`
              : undefined,
          )
        : undefined,
    ),
  };
});
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
    <UiInline as="header" wrap justify="normal">
      <UiInline as="label" justify="normal"
        >Окружение
        <UiControl
          as="select"
          appearance="filled"
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
        </UiControl>
      </UiInline>
      <UiButton :active="!all" @click="commands.run('ide.docker.open')">Проект</UiButton>
      <UiButton :active="all" @click="commands.run('ide.docker.open', { all: true })"
        >Все контейнеры</UiButton
      >
      <UiButton :disabled="busy" @click="commands.run('ide.docker.refresh')">Обновить</UiButton>
      <span class="muted">{{
        snapshot?.connected ? `Docker ${snapshot.version}` : "нет подключения"
      }}</span>
    </UiInline>
    <DockerDaemonNotice
      v-if="error || snapshot?.error"
      :message="error || snapshot?.error || ''"
      :daemon="snapshot?.daemon"
      :starting="starting"
      size="sm"
      @start="commands.run('ide.docker.daemon.start')"
    />
    <UiEmpty v-if="!snapshot && !error">Подключение…</UiEmpty>
    <UiEmpty v-else-if="snapshot && !snapshot.enabled"
      >Docker выключен.
      <router-link to="/settings">Открыть настройки интеграций</router-link></UiEmpty
    >
    <template v-if="snapshot?.enabled">
      <DockerBinding v-if="!all" />
      <UiInline
        v-if="!all && snapshot.binding"
        class="actions compose-actions"
        wrap
        justify="normal"
      >
        <UiButton
          v-for="action in actions"
          :key="action.id"
          size="sm"
          :disabled="!commands.scope.describe(`ide.docker.${action.id}`)?.enabled"
          @click="commands.run(`ide.docker.${action.id}`)"
          >{{ action.title }}</UiButton
        >
        <UiMessage
          as="span"
          v-if="snapshot.connected && !snapshot.composeVersion"
          tone="danger"
          variant="padded"
          flush
          wrap
          >Docker Compose не установлен</UiMessage
        >
      </UiInline>
      <UiEmpty v-if="snapshot.connected && !containers.length">{{
        !all && !snapshot.binding
          ? "Сохраните привязку или откройте все контейнеры."
          : "Контейнеров нет."
      }}</UiEmpty>
      <div v-if="containers.length" class="table-wrap">
        <UiTable padding="var(--sp-2) var(--sp-3)" header-tone="muted" :header-weight="400">
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
        </UiTable>
      </div>
      <article v-if="current" class="details">
        <h3>{{ current.name }}</h3>
        <p class="muted">
          {{ current.id.slice(0, 12) }} · {{ current.image }} ·
          {{ absoluteTime(current.startedAt) }}
        </p>
        <UiInline class="actions" wrap justify="normal">
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
          <UiControl
            as="select"
            appearance="filled"
            v-model="shell"
            aria-label="Оболочка контейнера"
          >
            <option>sh</option>
            <option>bash</option>
          </UiControl>
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
        </UiInline>
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
header {
  padding: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.muted,
small {
  color: var(--muted);
}
.failed {
  color: var(--err);
}
select {
  width: auto;
  --ui-control-padding-right: 28px;
}
.compose-actions {
  padding: var(--sp-3);
}
.table-wrap {
  overflow: auto;
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
