<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";

interface NetworkState {
  mode: "local" | "lan";
  passwordRequired: boolean;
  lanUrl: string | null;
  lanUrls: string[];
}

const state = ref<NetworkState | null>(null);
const password = ref("");
const busy = ref(false);
const status = ref("");
const error = ref("");

async function load() {
  const response = await fetch("/api/app/network", { cache: "no-store" });
  const data = (await response.json()) as NetworkState & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить доступ по сети");
  state.value = data;
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

async function apply(nextPassword: string | undefined) {
  if (!state.value) return;
  busy.value = true;
  error.value = "";
  status.value = "";
  const currentPid = await health();
  try {
    const response = await fetch("/api/app/network", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.value.mode, password: nextPassword }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить пароль");
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

async function save() {
  await apply(password.value.length > 0 ? password.value : undefined);
}

async function clearPassword() {
  await apply("");
}

async function copyAddress(address: string) {
  try {
    await navigator.clipboard.writeText(address);
    status.value = "Адрес скопирован";
  } catch {
    error.value = "Не удалось скопировать адрес";
  }
}

onMounted(() => {
  load().catch((err) => {
    error.value = err instanceof Error ? err.message : "Не удалось загрузить доступ по сети";
  });
});
</script>

<template>
  <div class="network-panel">
    <p v-if="!state" class="muted">Загрузка…</p>
    <template v-else>
      <dl class="summary">
        <div>
          <dt>Режим</dt>
          <dd>{{ state.mode === "lan" ? "Локальная сеть" : "Только localhost" }}</dd>
        </div>
        <div>
          <dt>Пароль</dt>
          <dd>{{ state.passwordRequired ? "Задан" : "Не задан" }}</dd>
        </div>
      </dl>

      <h3>Адреса</h3>
      <ul v-if="state.mode === 'lan' && state.lanUrls.length" class="addresses">
        <li v-for="address in state.lanUrls" :key="address">
          <code>{{ address }}</code>
          <button :disabled="busy" @click="copyAddress(address)">копировать</button>
        </li>
      </ul>
      <p v-else class="muted">
        {{ state.mode === "lan" ? "Адреса сети не найдены" : "Сервер доступен только на этой машине" }}
      </p>

      <h3>Пароль доступа</h3>
      <div class="password-row">
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="Новый пароль"
          :disabled="busy"
        />
        <UiButton variant="solid" :disabled="busy || !password" @click="save">Сохранить</UiButton>
        <UiButton v-if="state.passwordRequired" :disabled="busy" @click="clearPassword"
          >Убрать</UiButton
        >
      </div>
      <UiHint v-if="state.passwordRequired" class="hint"
        >Пароль задан. Введите новый, чтобы заменить, или нажмите «Убрать».</UiHint
      >
      <UiHint v-else class="hint"
        >Без пароля любой в локальной сети сможет управлять Projector, включая терминалы.</UiHint
      >
    </template>

    <p v-if="error || status" role="status" class="message" :class="{ error }">
      {{ error || status }}
    </p>
  </div>
</template>

<style scoped>
.network-panel {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
  container-type: inline-size;
}
h3 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 500;
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  margin: 0;
}
.summary div {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
dt {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
dd {
  margin: var(--sp-1) 0 0;
  font-weight: 500;
}
.addresses {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.addresses li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.addresses code {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.addresses button {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.password-row {
  display: flex;
  gap: var(--sp-2);
}
.password-row input {
  flex: 1;
  min-width: 0;
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-sm);
}
.message {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
