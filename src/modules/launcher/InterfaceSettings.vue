<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
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
    <h2>Как открывать Projector</h2>
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
    <UiHint class="hint" role="status">
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
    </UiHint>
    <div class="actions">
      <UiButton
        variant="solid"
        :disabled="!ready || busy || (saved === mode && savedShortcut === shortcut)"
        @click="save"
      >
        Сохранить
      </UiButton>
      <UiButton :disabled="!ready || busy" @click="open">Открыть выбранный режим</UiButton>
    </div>
    <UiHint class="hint">
      В KDE сочетание регистрируется автоматически; занятые клавиши не перехватываются. Клик по
      иконке в трее открывает поиск, меню даёт доступ к проектам, настройкам и выходу.
    </UiHint>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
  </section>
</template>

<style scoped>
.interface-settings {
  margin-bottom: var(--sp-6);
}
h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-lg);
  font-weight: 500;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
}
.mode {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  padding: var(--sp-3) 0;
  cursor: pointer;
}
.mode input {
  margin-top: var(--sp-1);
}
strong {
  display: block;
  font-weight: 500;
}
small {
  display: block;
  color: var(--muted);
  font-size: var(--fs-xs);
  margin-top: var(--sp-1);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.hint {
  margin-top: var(--sp-4);
  font-size: var(--fs-xs);
}
.shortcut-label {
  display: block;
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
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
