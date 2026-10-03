<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openExternalLink } from "../../../common/utilities/open-external-link.ts";
import { lanPassword } from "../../../common/utilities/lan-auth.ts";
import { deferTerminalText } from "../lib/keyboard.ts";
import { bindTerminalInput } from "../lib/input.ts";
import { bindTerminalLinks, type TerminalLink } from "../lib/links.ts";
import { droppedTerminalPaths, isTerminalFileDrag, terminalTextForPaths } from "../lib/drop.ts";
import { terminalRequest } from "../lib/api.ts";
import type {
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSession,
} from "../../../../core/modules/terminal/index.ts";

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  return {
    background: token("--bg-2"),
    foreground: token("--text-2"),
    cursor: token("--text-2"),
    selectionBackground: token("--line-strong"),
  };
}

/**
 * Экран одной сессии: xterm, WebSocket и ввод. Компонент монтируется, пока вкладка видна,
 * и при показе восстанавливает экран из снимка сервера.
 */
const props = defineProps<{ projectId: string; session: TerminalSession; focused?: boolean }>();
const emit = defineEmits<{
  open: [path: string, line: number | undefined, column: number | undefined, external: boolean];
  status: [session: TerminalSession];
  sessions: [sessions: TerminalSession[]];
  ended: [];
}>();
const container = ref<HTMLElement>();
const error = ref("");
const draggingFiles = ref(false);
const connection = ref<"offline" | "connecting" | "connected">("offline");
const sessionId = props.session.id;
const statusText = computed(() => {
  if (props.session.status === "exited") {
    const failed = !props.session.stopRequested && props.session.exitCode !== 0;
    return `${failed ? "ошибка" : "завершён"} · код ${props.session.exitCode ?? "—"}`;
  }
  if (props.session.stopRequested) return "завершаю…";
  return connection.value === "connected"
    ? ""
    : connection.value === "connecting"
      ? "подключение…"
      : "нет соединения";
});
let terminal: Terminal | undefined;
let links: IDisposable | undefined;
let fit: FitAddon | undefined;
let observer: ResizeObserver | undefined;
let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 500;
let destroyed = false;
let ready = false;
let generation = 0;
let linkGeneration = 0;
let resizeFrame = 0;
let rendering = Promise.resolve();

const running = () => ready && props.session.status === "running" && !props.session.stopRequested;

async function openTerminalLink(link: TerminalLink) {
  if (link.web) {
    openExternalLink(link.path);
    return;
  }
  if (props.session.docker) { error.value = "Пути Docker-терминала не сопоставлены с файлами хоста"; return; }
  const current = ++linkGeneration;
  error.value = "";
  try {
    const file = await terminalRequest<{ path: string; external: boolean }>(
      props.projectId,
      `/${encodeURIComponent(sessionId)}?${new URLSearchParams({ link: link.path })}`,
    );
    if (!destroyed && current === linkGeneration)
      emit("open", file.path, link.line, link.column, file.external);
  } catch (err) {
    if (!destroyed && current === linkGeneration)
      error.value = err instanceof Error ? err.message : "Не удалось открыть файл из терминала";
  }
}

function send(message: TerminalClientMessage): void {
  if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function dragFiles(event: DragEvent): void {
  if (!isTerminalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  if (props.session.docker) { if (event.dataTransfer) event.dataTransfer.dropEffect = "none"; return; }
  draggingFiles.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = running() ? "copy" : "none";
}

async function dropFiles(event: DragEvent): Promise<void> {
  event.preventDefault();
  draggingFiles.value = false;
  if (props.session.docker) { error.value = "Файловые пути хоста недоступны в Docker-терминале"; return; }
  if (!isTerminalFileDrag(event.dataTransfer)) return;
  const currentGeneration = generation;
  if (!running()) {
    error.value = "Откройте работающий терминал и дождитесь подключения";
    return;
  }
  error.value = "";
  try {
    const paths = await droppedTerminalPaths(
      event.dataTransfer,
      async (file) => {
        if (destroyed || currentGeneration !== generation) throw new Error("Терминал переключён");
        const response = await fetch(
          `/api/projects/${encodeURIComponent(props.projectId)}/terminals/${encodeURIComponent(sessionId)}?name=${encodeURIComponent(file.name)}`,
          { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не удалось загрузить файл");
        return result.path as string;
      },
      async (projectId, path) => {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не удалось получить путь проекта");
        return `${result.project.path.replace(/\/+$/, "")}/${path}`;
      },
    );
    if (destroyed || currentGeneration !== generation) return;
    if (!paths.length) throw new Error("Не удалось получить пути перетащенных файлов");
    if (!running()) throw new Error("Терминал больше не принимает ввод");
    terminal?.paste(terminalTextForPaths(paths));
    terminal?.focus();
  } catch (err) {
    if (!destroyed && currentGeneration === generation)
      error.value = err instanceof Error ? err.message : "Не удалось вставить файлы";
  }
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

function focusTerminal() {
  if (!document.activeElement?.matches(".tab-rename")) terminal?.focus();
}

function connect(): void {
  disconnect();
  if (!terminal) return;
  error.value = "";
  terminal.reset();
  connection.value = "connecting";
  const currentGeneration = generation;
  const url = new URL("/api/terminal/socket", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("session", sessionId);
  const token = lanPassword();
  if (token) url.searchParams.set("token", token);
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
            emit("status", message.session);
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
              if (props.focused) focusTerminal();
              resolve();
            });
          } else if (message.type === "output")
            terminal.write(message.data, () => {
              if (currentGeneration === generation && !destroyed)
                send({ type: "ack", length: message.data.length });
              resolve();
            });
          else if (message.type === "status") {
            emit("status", message.session);
            if (terminal.cols !== message.session.cols || terminal.rows !== message.session.rows)
              terminal.resize(message.session.cols, message.session.rows);
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
      emit("ended");
      return;
    }
    reconnectTimer = setTimeout(async () => {
      try {
        const data = await terminalRequest<{ sessions: TerminalSession[] }>(props.projectId);
        if (currentGeneration !== generation || destroyed) return;
        emit("sessions", data.sessions);
        // A vanished session unmounts this view through the list update.
        if (data.sessions.some((item) => item.id === sessionId)) connect();
      } catch {
        if (currentGeneration === generation && !destroyed) connect();
      }
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10000);
  };
}

watch(
  () => props.focused,
  (focused) => {
    if (focused && ready) focusTerminal();
  },
);

onMounted(() => {
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"DejaVu Sans Mono", monospace',
    fontSize: 13,
    scrollback: 5000,
    allowProposedApi: false,
    linkHandler: {
      activate: (event, value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") return;
        event.preventDefault();
        event.stopPropagation();
        openExternalLink(url.href);
      },
    },
    theme: terminalTheme(),
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container.value!);
  links = bindTerminalLinks(terminal, (link) => {
    void openTerminalLink(link);
  });
  bindTerminalInput(terminal, send, running);
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
      // Returning false does not cancel the browser's own paste event: without this the text lands twice.
      event.preventDefault();
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (ready && props.session.status === "running") terminal?.paste(text);
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
  connect();
});
onBeforeUnmount(() => {
  destroyed = true;
  disconnect();
  cancelAnimationFrame(resizeFrame);
  observer?.disconnect();
  links?.dispose();
  terminal?.dispose();
});
</script>

<template>
  <section class="terminal-view" tabindex="-1">
    <p v-if="statusText" class="status" role="status">{{ statusText }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div
      class="screen-wrap"
      data-terminal-drop
      @dragenter.stop="dragFiles"
      @dragover.stop="dragFiles"
      @dragleave.stop="
        !($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node) &&
        (draggingFiles = false)
      "
      @drop.stop="dropFiles"
    >
      <div v-if="draggingFiles" class="drop-hint">Бросьте файлы — вставим пути в терминал</div>
      <div ref="container" class="screen" />
    </div>
  </section>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-2);
}
.status {
  margin: 0;
  padding: 4px 12px;
  font-size: var(--fs-2xs);
  color: var(--faint);
}
.error {
  margin: 0;
  padding: 10px 12px;
  color: var(--err);
  font-size: var(--fs-xs);
}
.screen-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  /* The padding lives here: FitAddon reads the parent's height, and padding on it hid half of the last row.
     No bottom padding: the fractional row left over by fitting already acts as one. */
  padding: 12px 12px 0;
}
.drop-hint {
  position: absolute;
  inset: 4px;
  z-index: 5;
  display: grid;
  place-items: center;
  pointer-events: none;
  border: 1px dashed var(--focus);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  color: var(--text);
  font-size: var(--fs-sm);
}
.screen {
  height: 100%;
}
</style>
