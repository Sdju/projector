<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import UiButton from "../../../common/ui/UiButton.vue";
import type {
  TerminalClientMessage,
  TerminalProgram,
  TerminalServerMessage,
  TerminalSession,
} from "../../../../shared/terminal.ts";

const props = defineProps<{ projectId: string }>();
const container = ref<HTMLElement>();
const sessions = ref<TerminalSession[]>([]);
const activeId = ref("");
const error = ref("");
const busy = ref(false);
const expanded = ref(false);
const connection = ref<"offline" | "connecting" | "connected">("offline");
const active = computed(() => sessions.value.find((session) => session.id === activeId.value));
const statusText = computed(() => {
  if (!active.value) return "";
  if (active.value.status === "exited") return `завершён · код ${active.value.exitCode ?? "—"}`;
  return connection.value === "connected"
    ? "подключён"
    : connection.value === "connecting"
      ? "подключение…"
      : "нет соединения";
});
let terminal: Terminal | undefined;
let fit: FitAddon | undefined;
let observer: ResizeObserver | undefined;
let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 500;
let destroyed = false;
let ready = false;
let generation = 0;
let resizeFrame = 0;
let rendering = Promise.resolve();

function rememberedSession(): string {
  try {
    return sessionStorage.getItem(`projector:terminal:${props.projectId}`) ?? "";
  } catch {
    return "";
  }
}

async function request<T>(projectId: string, suffix = "", init?: RequestInit): Promise<T> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/terminals${suffix}`,
    {
      ...init,
      headers: { "Content-Type": "application/json" },
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка терминала");
  return data as T;
}

function send(message: TerminalClientMessage): void {
  if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function fitTerminal(): void {
  if (!container.value?.clientWidth || !container.value.clientHeight || !terminal || !fit) return;
  fit.fit();
  if (terminal.cols > 500 || terminal.rows > 200)
    terminal.resize(Math.min(500, terminal.cols), Math.min(200, terminal.rows));
  if (ready) send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
}

function scheduleFit(): void {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(fitTerminal);
}

function disconnect(): void {
  generation += 1;
  ready = false;
  clearTimeout(reconnectTimer);
  const previous = socket;
  socket = undefined;
  if (previous) {
    previous.onclose = null;
    previous.close();
  }
  connection.value = "offline";
}

function updateSession(session: TerminalSession): void {
  const index = sessions.value.findIndex((item) => item.id === session.id);
  if (index !== -1) sessions.value[index] = session;
}

function connect(): void {
  disconnect();
  if (!activeId.value || !terminal) return;
  error.value = "";
  terminal.reset();
  connection.value = "connecting";
  const currentGeneration = generation;
  const url = new URL("/api/terminal/socket", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("session", activeId.value);
  const client = new WebSocket(url);
  socket = client;
  client.onmessage = (event) => {
    if (currentGeneration !== generation || destroyed || !terminal) return;
    const message = JSON.parse(event.data) as TerminalServerMessage;
    rendering = rendering.then(
      () =>
        new Promise<void>((resolve) => {
          if (currentGeneration !== generation || destroyed || !terminal) {
            resolve();
            return;
          }
          if (message.type === "snapshot") {
            updateSession(message.session);
            terminal.resize(message.session.cols, message.session.rows);
            terminal.reset();
            terminal.write(message.data, () => {
              if (currentGeneration !== generation || destroyed) {
                resolve();
                return;
              }
              ready = true;
              retryDelay = 500;
              connection.value = "connected";
              fitTerminal();
              terminal?.focus();
              resolve();
            });
          } else if (message.type === "output")
            terminal.write(message.data, () => {
              if (currentGeneration === generation && !destroyed)
                send({ type: "ack", length: message.data.length });
              resolve();
            });
          else if (message.type === "status") {
            updateSession(message.session);
            if (terminal.cols !== message.session.cols || terminal.rows !== message.session.rows) {
              terminal.resize(message.session.cols, message.session.rows);
            }
            resolve();
          } else {
            error.value = message.message;
            resolve();
          }
        }),
    );
  };
  client.onclose = (event) => {
    if (currentGeneration !== generation || destroyed) return;
    ready = false;
    connection.value = "offline";
    if (event.code === 1000) {
      void loadSessions();
      return;
    }
    reconnectTimer = setTimeout(async () => {
      try {
        const data = await request<{ sessions: TerminalSession[] }>(props.projectId);
        if (currentGeneration !== generation || destroyed) return;
        sessions.value = data.sessions;
        if (data.sessions.some((item) => item.id === activeId.value)) connect();
        else activeId.value = data.sessions[0]?.id ?? "";
      } catch {
        if (currentGeneration === generation && !destroyed) connect();
      }
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10000);
  };
}

async function loadSessions(): Promise<void> {
  const projectId = props.projectId;
  try {
    const data = await request<{ sessions: TerminalSession[] }>(projectId);
    if (destroyed || props.projectId !== projectId) return;
    sessions.value = data.sessions;
    if (!data.sessions.some((item) => item.id === activeId.value)) {
      const remembered = rememberedSession();
      activeId.value =
        data.sessions.find((item) => item.id === remembered)?.id ?? data.sessions[0]?.id ?? "";
    }
  } catch (err) {
    if (!destroyed && props.projectId === projectId)
      error.value = err instanceof Error ? err.message : "Не удалось загрузить терминалы";
  }
}

async function create(program: TerminalProgram): Promise<void> {
  busy.value = true;
  error.value = "";
  const projectId = props.projectId;
  try {
    fitTerminal();
    const data = await request<{ session: TerminalSession }>(projectId, "", {
      method: "POST",
      body: JSON.stringify({ program, cols: terminal?.cols ?? 80, rows: terminal?.rows ?? 24 }),
    });
    if (destroyed || projectId !== props.projectId) return;
    sessions.value.push(data.session);
    activeId.value = data.session.id;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось открыть терминал";
  } finally {
    busy.value = false;
  }
}

async function closeActive(): Promise<void> {
  if (!activeId.value || busy.value) return;
  busy.value = true;
  error.value = "";
  const id = activeId.value;
  try {
    await request(props.projectId, `/${encodeURIComponent(id)}`, { method: "DELETE" });
    sessions.value = sessions.value.filter((item) => item.id !== id);
    if (activeId.value === id) activeId.value = sessions.value[0]?.id ?? "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось закрыть терминал";
  } finally {
    busy.value = false;
  }
}

watch(activeId, () => {
  if (activeId.value) {
    try {
      sessionStorage.setItem(`projector:terminal:${props.projectId}`, activeId.value);
    } catch {
      /* Optional tab state. */
    }
  }
  retryDelay = 500;
  connect();
});
watch(
  () => props.projectId,
  () => {
    disconnect();
    activeId.value = "";
    sessions.value = [];
    terminal?.reset();
    void loadSessions();
  },
);
watch(expanded, async () => {
  await nextTick();
  scheduleFit();
  terminal?.focus();
});

function escapeFullscreen(event: KeyboardEvent): void {
  if (event.key === "Escape" && expanded.value && event.target === container.value?.parentElement)
    expanded.value = false;
}

onMounted(() => {
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"DejaVu Sans Mono", monospace',
    fontSize: 13,
    scrollback: 5000,
    allowProposedApi: false,
    theme: {
      background: "#171815",
      foreground: "#d6d3ca",
      cursor: "#d6d3ca",
      selectionBackground: "#4a4a44",
    },
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(
    new WebLinksAddon((_event, url) => window.open(url, "_blank", "noopener,noreferrer")),
  );
  terminal.open(container.value!);
  terminal.onData((data) => {
    if (active.value?.status !== "running") return;
    // Large clipboard pastes are split below the server's frame limit.
    for (let offset = 0; offset < data.length; offset += 8192)
      send({ type: "input", data: data.slice(offset, offset + 8192) });
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyC") {
      const selection = terminal?.getSelection();
      if (selection)
        void navigator.clipboard.writeText(selection).catch(() => {
          error.value = "Не удалось скопировать выделение";
        });
      return false;
    }
    if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyV") {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (ready && active.value?.status === "running") terminal?.paste(text);
        })
        .catch(() => {
          error.value = "Вставьте текст через меню браузера или Shift+Insert";
        });
      return false;
    }
    return true;
  });
  observer = new ResizeObserver(scheduleFit);
  observer.observe(container.value!);
  scheduleFit();
  void document.fonts.ready.then(() => {
    if (!destroyed) scheduleFit();
  });
  void loadSessions();
});
onBeforeUnmount(() => {
  destroyed = true;
  disconnect();
  cancelAnimationFrame(resizeFrame);
  observer?.disconnect();
  terminal?.dispose();
});
</script>

<template>
  <section class="terminal-pane" :class="{ expanded }" tabindex="-1" @keydown="escapeFullscreen">
    <header>
      <span class="label">терминал</span>
      <span class="status" role="status">{{ statusText }}</span>
      <div class="actions">
        <UiButton variant="chip" :disabled="busy" @click="create('shell')">+ shell</UiButton>
        <UiButton variant="chip" :disabled="busy" @click="create('codex')">+ Codex</UiButton>
        <UiButton variant="chip" :disabled="busy" @click="create('claude')">+ Claude Code</UiButton>
        <UiButton variant="chip" @click="expanded = !expanded">{{
          expanded ? "свернуть" : "развернуть"
        }}</UiButton>
        <UiButton v-if="active" variant="danger" :disabled="busy" @click="closeActive"
          >закрыть сессию</UiButton
        >
      </div>
    </header>
    <div v-if="sessions.length" class="tabs" role="tablist" aria-label="Сессии терминала">
      <button
        v-for="(session, index) in sessions"
        :key="session.id"
        role="tab"
        :aria-selected="session.id === activeId"
        :class="{ selected: session.id === activeId }"
        @click="activeId = session.id"
      >
        {{ session.title }} {{ index + 1 }}{{ session.status === "exited" ? " · завершён" : "" }}
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="screen-wrap">
      <div ref="container" class="screen" :class="{ inactive: !active }" />
      <div v-if="!active" class="empty">Откройте shell, Codex или Claude Code в папке проекта.</div>
    </div>
    <footer>
      Ctrl+C — прервать · Ctrl+Shift+C/V — копировать / вставить · закрытие страницы сохраняет
      сессию
    </footer>
  </section>
</template>

<style scoped>
.terminal-pane {
  margin: 24px 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #171815;
  overflow: hidden;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.status {
  font-size: 11px;
  color: var(--faint);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 12px 0;
}
.tabs button {
  flex-shrink: 0;
  padding: 5px 9px;
  border: 1px solid transparent;
  border-radius: 3px;
  font: 12px var(--mono);
  color: var(--muted);
}
.tabs button.selected {
  border-color: var(--line);
  color: var(--text);
}
.screen-wrap {
  position: relative;
}
.screen {
  height: 420px;
  padding: 12px;
}
.screen.inactive {
  visibility: hidden;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 24px;
  color: var(--muted);
  font-size: 13px;
}
.error {
  margin: 0;
  padding: 10px 12px;
  color: var(--err);
  font-size: 12px;
}
footer {
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 11px;
}
.expanded {
  position: fixed;
  inset: 12px;
  z-index: 30;
  margin: 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 0 20px var(--bg);
}
.expanded .screen-wrap {
  flex: 1;
  min-height: 0;
}
.expanded .screen {
  height: 100%;
}
</style>
