<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";

interface NetworkState {
  mode: "local" | "lan";
  passwordRequired: boolean;
  lanUrl: string | null;
}

const mode = ref<"local" | "lan">("local");
const passwordRequired = ref(false);
const lanUrl = ref<string | null>(null);
const password = ref("");
const busy = ref(false);
const error = ref("");
const status = ref("");
const ready = ref(false);

async function load() {
  const response = await fetch("/api/app/network", { cache: "no-store" });
  const data = (await response.json()) as NetworkState & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить режим доступа");
  mode.value = data.mode;
  passwordRequired.value = data.passwordRequired;
  lanUrl.value = data.lanUrl;
  ready.value = true;
}

function health() {
  return fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(2000) })
    .then(async (response) => {
      const data = await response.json();
      return response.ok && Number.isInteger(data.pid) ? (data.pid as number) : null;
    })
    .catch(() => null);
}

async function waitForRestart(pid: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await health();
    if (current !== null && current !== pid) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Сервер не перезапустился за 60 секунд");
}

async function save() {
  await apply(password.value.length > 0 ? password.value : undefined);
}

async function clearPassword() {
  await apply("");
}

async function apply(nextPassword: string | undefined) {
  busy.value = true;
  error.value = "";
  status.value = "";
  const currentPid = await health();
  try {
    const response = await fetch("/api/app/network", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode.value, password: nextPassword }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить режим доступа");
    if (data.restarted) {
      status.value = "Сервер перезапускается…";
      if (currentPid !== null) await waitForRestart(currentPid);
      window.location.reload();
    } else {
      await load();
      password.value = "";
      status.value = "Сохранено";
      busy.value = false;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось сохранить";
    busy.value = false;
  }
}

onMounted(() => {
  load().catch((err) => {
    error.value = err instanceof Error ? err.message : "Не удалось загрузить режим доступа";
  });
});
</script>

<template>
  <section class="network-settings">
    <h2>Доступ по локальной сети</h2>
    <fieldset :disabled="!ready || busy">
      <legend class="sr-only">Режим доступа</legend>
      <label class="mode">
        <input v-model="mode" type="radio" name="network" value="local" />
        <span
          ><strong>Только локально</strong
          ><small>Сервер слушает localhost и недоступен другим устройствам.</small></span
        >
      </label>
      <label class="mode">
        <input v-model="mode" type="radio" name="network" value="lan" />
        <span
          ><strong>Локальная сеть</strong
          ><small>Открывает интерфейс для телефона и других устройств в вашей сети.</small></span
        >
      </label>
    </fieldset>
    <template v-if="mode === 'lan'">
      <label class="password-label" for="projector-lan-password"
        >Пароль доступа (необязательно)</label
      >
      <input
        id="projector-lan-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        placeholder="Оставьте пустым, чтобы не менять пароль"
        :disabled="!ready || busy"
      />
      <UiHint class="hint">
        <template v-if="passwordRequired"
          >Пароль уже задан. Введите новый, чтобы заменить его, или очистите защиту
          вручную.</template
        >
        <template v-else
          >Без пароля любой в локальной сети сможет управлять Projector, включая
          терминалы.</template
        >
      </UiHint>
      <UiHint v-if="lanUrl" class="hint">
        Адрес для другого устройства: <code>{{ lanUrl }}</code>
      </UiHint>
    </template>
    <div class="actions">
      <UiButton variant="solid" :disabled="!ready || busy" @click="save"
        >Сохранить и перезапустить</UiButton
      >
      <UiButton v-if="passwordRequired" :disabled="!ready || busy" @click="clearPassword"
        >Убрать пароль</UiButton
      >
    </div>
    <p v-if="error || status" role="status" :class="{ error }">{{ error || status }}</p>
  </section>
</template>

<style scoped>
.network-settings {
  margin-bottom: var(--sp-6);
}
h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
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
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.password-label {
  display: block;
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
}
input[type="password"] {
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
