<script setup lang="ts">
import { onMounted, ref } from "vue";
const mode = ref("native");
const saved = ref("native");
const shortcut = ref("Ctrl+Alt+Space");
const savedShortcut = ref("Ctrl+Alt+Space");
const hotkey = ref<{ supported: boolean; active: boolean; shortcut: string }>();
const error = ref("");
const status = ref("");
const ready = ref(false);
const busy = ref(false);
const modes = [
  {
    id: "native",
    title: "Системное окно",
    description: "Нативное поле поиска и список приложений. По умолчанию.",
  },
  {
    id: "window",
    title: "Отдельное веб-окно",
    description: "Интерфейс Projector без вкладок и адресной строки.",
  },
  { id: "browser", title: "Страница в браузере", description: "Обычная вкладка в вашем браузере." },
];
async function request(method: string, body?: object) {
  const response = await fetch("/api/launcher/settings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
onMounted(async () => {
  try {
    const data = await request("GET");
    mode.value = saved.value = data.mode;
    shortcut.value = savedShortcut.value = data.shortcut;
    hotkey.value = data.hotkey;
    ready.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось загрузить настройки";
  }
});
async function save() {
  busy.value = true;
  error.value = "";
  status.value = "";
  try {
    const data = await request("PUT", { mode: mode.value, shortcut: shortcut.value });
    saved.value = mode.value;
    savedShortcut.value = shortcut.value;
    hotkey.value = data.hotkey;
    status.value = "Сохранено";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось сохранить";
  } finally {
    busy.value = false;
  }
}
async function open() {
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/app/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось открыть";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="interface-settings">
    <h1>Как открывать Projector</h1>
    <fieldset :disabled="!ready || busy">
      <legend class="sr-only">Режим интерфейса</legend>
      <label v-for="option in modes" :key="option.id" class="mode">
        <input v-model="mode" type="radio" name="interface" :value="option.id" />
        <span
          ><strong>{{ option.title }}</strong
          ><small>{{ option.description }}</small></span
        >
      </label>
    </fieldset>
    <label class="shortcut-label" for="projector-shortcut">Горячая клавиша</label>
    <select id="projector-shortcut" v-model="shortcut" :disabled="!ready || busy">
      <option value="Ctrl+Alt+Space">Ctrl + Alt + Space</option>
      <option value="Super+Space">Super + Space</option>
      <option value="Alt+Space">Alt + Space</option>
      <option value="">Выключена</option>
    </select>
    <p class="hint" role="status">
      <template v-if="!shortcut">Горячая клавиша выключена.</template>
      <template v-else-if="hotkey?.active"
        >Работает: {{ hotkey.shortcut }}. Projector остаётся в трее после закрытия поиска.</template
      >
      <template v-else-if="hotkey?.supported"
        >Горячая клавиша пока не активна. Сохраните настройки или запустите Projector.</template
      >
      <template v-else
        >В этом окружении назначьте системный хоткей на команду
        <code>projector toggle</code>.</template
      >
    </p>
    <div class="actions">
      <button
        :disabled="!ready || busy || (saved === mode && savedShortcut === shortcut)"
        @click="save"
      >
        Сохранить
      </button>
      <button :disabled="!ready || busy" @click="open">Открыть выбранный режим</button>
    </div>
    <p class="hint">
      В KDE сочетание регистрируется автоматически; занятые клавиши не перехватываются. Клик по
      иконке в трее открывает поиск, меню даёт доступ к проектам, настройкам и выходу.
    </p>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
  </section>
</template>

<style scoped>
.interface-settings {
  margin-bottom: 40px;
}
h1 {
  margin: 0 0 20px;
  font-size: 24px;
  font-weight: 500;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
}
.mode {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 0;
  cursor: pointer;
}
.mode input {
  width: auto;
  margin-top: 5px;
  accent-color: var(--focus);
}
strong {
  display: block;
  font-weight: 500;
}
small {
  display: block;
  color: var(--muted);
  margin-top: 4px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}
.actions button {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  margin-top: 20px;
}
.shortcut-label {
  display: block;
  margin: 20px 0 8px;
}
select {
  max-width: 320px;
}
.error {
  color: var(--err);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
