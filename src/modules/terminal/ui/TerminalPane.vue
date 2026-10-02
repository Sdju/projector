<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import UiButton from "../../../common/ui/UiButton.vue";
import IconTerminal from "~icons/lucide/terminal";
import IconCodex from "~icons/simple-icons/openai";
import IconClaude from "~icons/simple-icons/claude";
import IconMaximize from "~icons/lucide/maximize-2";
import IconMinimize from "~icons/lucide/minimize-2";
import IconClose from "~icons/lucide/x";
import { deferTerminalText } from "../lib/keyboard.ts";
import { bindTerminalInput } from "../lib/input.ts";
import type {
  TerminalClientMessage,
  TerminalProgram,
  TerminalServerMessage,
  TerminalSession,
} from "../../../../shared/terminal.ts";

const props = defineProps<{ projectId: string; embedded?: boolean }>();
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
    ? ""
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

async function terminalStarted(event: Event): Promise<void> {
  const detail = (event as CustomEvent<{ projectId: string; sessionId: string }>).detail;
  if (detail.projectId !== props.projectId) return;
  await loadSessions();
  if (!destroyed && sessions.value.some((session) => session.id === detail.sessionId))
    activeId.value = detail.sessionId;
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
  bindTerminalInput(terminal, send, () => ready && active.value?.status === "running");
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
    // Fcitx virtual layouts can translate a US keydown only in keypress.
    // Let xterm's text/composition handlers receive the translated character
    // instead of sending the physical layout's lowercase letter immediately.
    if (deferTerminalText(event)) return false;
    return true;
  });
  observer = new ResizeObserver(scheduleFit);
  observer.observe(container.value!);
  scheduleFit();
  void document.fonts.ready.then(() => {
    if (!destroyed) scheduleFit();
  });
  window.addEventListener("projector:terminal-started", terminalStarted);
  void loadSessions();
});
onBeforeUnmount(() => {
  window.removeEventListener("projector:terminal-started", terminalStarted);
  destroyed = true;
  disconnect();
  cancelAnimationFrame(resizeFrame);
  observer?.disconnect();
  terminal?.dispose();
});
</script>

<template>
  <section
    class="terminal-pane"
    :class="{ expanded, embedded }"
    tabindex="-1"
    @keydown="escapeFullscreen"
  >
    <header>
      <div class="actions">
        <slot name="actions" />
        <div class="session-actions" role="group" aria-label="Новая терминальная сессия">
          <UiButton
            class="icon-button"
            variant="chip"
            :disabled="busy"
            title="Новый shell"
            aria-label="Новый shell"
            @click="create('shell')"
            ><IconTerminal aria-hidden="true"
          /></UiButton>
          <UiButton
            class="icon-button"
            variant="chip"
            :disabled="busy"
            title="Новый Codex"
            aria-label="Новый Codex"
            @click="create('codex')"
            ><IconCodex aria-hidden="true"
          /></UiButton>
          <UiButton
            class="icon-button"
            variant="chip"
            :disabled="busy"
            title="Новый Claude Code"
            aria-label="Новый Claude Code"
            @click="create('claude')"
            ><IconClaude aria-hidden="true"
          /></UiButton>
        </div>
        <div class="view-actions">
          <UiButton
            class="icon-button"
            variant="chip"
            :title="expanded ? 'Свернуть терминал' : 'Развернуть терминал'"
            :aria-label="expanded ? 'Свернуть терминал' : 'Развернуть терминал'"
            @click="expanded = !expanded"
            ><IconMinimize v-if="expanded" aria-hidden="true" /><IconMaximize
              v-else
              aria-hidden="true"
          /></UiButton>
          <UiButton
            v-if="active"
            class="icon-button"
            variant="danger"
            :disabled="busy"
            title="Закрыть сессию"
            aria-label="Закрыть сессию"
            @click="closeActive"
            ><IconClose aria-hidden="true"
          /></UiButton>
        </div>
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
    <slot name="status" />
    <p v-if="statusText" class="status" role="status">{{ statusText }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="screen-wrap">
      <div ref="container" class="screen" :class="{ inactive: !active }" />
    </div>
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
.status {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--faint);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.session-actions,
.view-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.view-actions {
  margin-left: auto;
}
.icon-button {
  width: 28px;
  height: 28px;
  padding: 5px;
  justify-content: center;
}
.icon-button svg {
  width: 15px;
  height: 15px;
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
.error {
  margin: 0;
  padding: 10px 12px;
  color: var(--err);
  font-size: 12px;
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
.embedded:not(.expanded) {
  margin: 0;
  border: 0;
  border-radius: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.embedded:not(.expanded) .screen-wrap {
  flex: 1;
  min-height: 0;
}
.embedded:not(.expanded) .screen {
  height: 100%;
}
.embedded header {
  gap: 6px;
}
</style>
