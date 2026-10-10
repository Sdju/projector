<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import UiButton from "../../common/ui/UiButton.vue";
import { readoutLines, useTabReadout } from "../../common/utilities/tab-readout.ts";
import {
  browserFrameSrc,
  fromProxyPath,
  isLocalBrowserTarget,
  normalizeBrowserInput,
} from "../../../core/modules/browser/index.ts";
import { useProjects } from "../project/index.ts";
import IconBack from "~icons/lucide/arrow-left";
import IconForward from "~icons/lucide/arrow-right";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconExternal from "~icons/lucide/external-link";
import IconServer from "~icons/lucide/server";

const props = defineProps<{ projectId: string; url?: string }>();
const emit = defineEmits<{ navigate: [url: string, title: string] }>();

type ProxyMode = "auto" | "on" | "off";
const history = ref<string[]>(props.url ? [props.url] : []);
const index = ref(props.url ? 0 : -1);
const current = computed(() => history.value[index.value] ?? "");
const address = ref(current.value);
const title = ref("");
const proxy = ref<ProxyMode>("auto");
const loads = ref(0);
const frame = ref<HTMLIFrameElement>();
const problem = ref("");

const { projects } = useProjects();
const devUrl = computed(
  () => projects.value.find((item) => item.id === props.projectId)?.runtime?.url ?? "",
);

const viaProxy = computed(() =>
  proxy.value === "auto" ? !isLocalBrowserTarget(current.value) : proxy.value === "on",
);
const src = computed(() =>
  browserFrameSrc(current.value, proxy.value === "auto" ? "auto" : proxy.value === "on"),
);
/** Прямые страницы (dev-серверы) держат свой origin; проксируемые и сам Projector — без него. */
const sandbox = computed(() => {
  const base = "allow-scripts allow-forms allow-popups allow-modals";
  if (viaProxy.value) return base;
  try {
    return new URL(current.value).origin === location.origin ? base : `${base} allow-same-origin`;
  } catch {
    return base;
  }
});

function go(raw: string, replace = false) {
  problem.value = "";
  let target: string;
  try {
    target = normalizeBrowserInput(raw);
  } catch {
    problem.value = "Некорректный адрес";
    return;
  }
  if (!target) return;
  if (target === current.value) {
    loads.value++;
    return;
  }
  if (replace && index.value >= 0) history.value[index.value] = target;
  else {
    history.value = [...history.value.slice(0, index.value + 1), target];
    index.value = history.value.length - 1;
  }
  address.value = target;
  title.value = "";
  emit("navigate", target, "");
}
function step(delta: number) {
  const next = index.value + delta;
  if (next < 0 || next >= history.value.length) return;
  index.value = next;
  address.value = current.value;
  title.value = "";
  emit("navigate", current.value, "");
}

// Страница из прокси сообщает свой настоящий адрес и заголовок: переходы по ссылкам попадают в историю.
useEventListener(window, "message", (event: MessageEvent) => {
  if (event.source !== frame.value?.contentWindow) return;
  const data = event.data as { projectorBrowser?: boolean; url?: unknown; title?: unknown };
  if (!data?.projectorBrowser || typeof data.url !== "string") return;
  if (data.url !== current.value) {
    history.value = [...history.value.slice(0, index.value + 1), data.url];
    index.value = history.value.length - 1;
    address.value = data.url;
  }
  const next = typeof data.title === "string" ? data.title.slice(0, 200) : "";
  if (next !== title.value) {
    title.value = next;
    emit("navigate", data.url, next);
  }
});

// Команда IDE (`ide.workbench.browser.navigate`) меняет адрес вкладки снаружи.
watch(
  () => props.url,
  (value) => {
    if (value && value !== current.value) go(value);
  },
);
function openOutside() {
  if (current.value) window.open(current.value, "_blank", "noopener");
}

useTabReadout(() => ({
  note: "Браузер",
  text: readoutLines(
    current.value ? `Адрес: ${current.value}` : "Адрес не задан",
    title.value && `Заголовок: ${title.value}`,
    current.value && `Режим: ${viaProxy.value ? "через прокси Projector" : "напрямую"}`,
    devUrl.value && `Dev-сервер проекта: ${devUrl.value}`,
  ),
}));
// Заголовок и адрес прямой страницы недоступны (чужой origin): показываем адрес без схемы.
const hostname = computed(() => {
  const real = fromProxyPath(src.value) ?? current.value;
  try {
    return new URL(real).host;
  } catch {
    return "";
  }
});
</script>

<template>
  <section class="browser" aria-label="Браузер">
    <form class="bar" @submit.prevent="go(address)">
      <UiButton
        icon
        size="sm"
        type="button"
        aria-label="Назад"
        title="Назад"
        :disabled="index <= 0"
        @click="step(-1)"
      >
        <IconBack aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        type="button"
        aria-label="Вперёд"
        title="Вперёд"
        :disabled="index >= history.length - 1"
        @click="step(1)"
      >
        <IconForward aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        type="button"
        aria-label="Перезагрузить страницу"
        title="Перезагрузить страницу"
        :disabled="!current"
        @click="loads++"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
      <input
        v-model="address"
        class="address"
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label="Адрес страницы"
        placeholder="Адрес, localhost:3000 или поисковый запрос"
        @focus="($event.target as HTMLInputElement).select()"
      />
      <UiButton
        v-if="devUrl"
        size="sm"
        type="button"
        title="Открыть dev-сервер проекта"
        @click="go(devUrl)"
      >
        <IconServer aria-hidden="true" /> Dev-сервер
      </UiButton>
      <select v-model="proxy" aria-label="Режим загрузки" title="Как загружать страницу">
        <option value="auto">Авто</option>
        <option value="on">Через прокси</option>
        <option value="off">Напрямую</option>
      </select>
      <UiButton
        icon
        size="sm"
        type="button"
        aria-label="Открыть во внешнем браузере"
        title="Открыть во внешнем браузере"
        :disabled="!current"
        @click="openOutside"
      >
        <IconExternal aria-hidden="true" />
      </UiButton>
    </form>
    <p v-if="problem" class="note error" role="alert">{{ problem }}</p>
    <p v-else-if="current && proxy === 'off' && !isLocalBrowserTarget(current)" class="note">
      Напрямую страница откроется, только если сайт разрешает встраивание. Иначе выберите «Авто».
    </p>
    <div class="stage">
      <iframe
        v-if="current"
        :key="`${loads}:${src}:${sandbox}`"
        ref="frame"
        class="page"
        :src="src"
        :title="title || hostname"
        :sandbox="sandbox"
        referrerpolicy="no-referrer"
      ></iframe>
      <div v-else class="start">
        <p>Введите адрес сайта или dev-сервера проекта.</p>
        <UiButton v-if="devUrl" size="sm" @click="go(devUrl)">
          <IconServer aria-hidden="true" /> {{ devUrl }}
        </UiButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.browser {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.address {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.bar select {
  width: auto;
  font-size: var(--fs-xs);
}
.note {
  margin: 0;
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.note.error {
  color: var(--danger, inherit);
}
.stage {
  flex: 1;
  min-height: 0;
  background: var(--bg-3);
  display: flex;
}
.page {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
  color-scheme: normal;
}
.start {
  margin: auto;
  display: grid;
  gap: var(--sp-3);
  justify-items: center;
  color: var(--muted);
}
</style>
