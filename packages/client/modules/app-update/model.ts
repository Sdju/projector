import { computed, ref, shallowRef } from "vue";
import { notifyInbox } from "../agent-core/index.ts";
import { deviceBase } from "../../common/utilities/device-url.ts";
import { checkAppUpdate, dismissAppUpdate, readAppUpdate } from "./client.ts";
import type { AppUpdateSnapshot } from "./types.ts";

const snapshot = shallowRef<AppUpdateSnapshot | null>(null);
const busy = ref(false);
const error = ref("");
let started = false;
let notified = "";

function apply(next: AppUpdateSnapshot): AppUpdateSnapshot {
  snapshot.value = next;
  error.value = next.error ?? "";
  if (next.inbox && next.latest && next.latest !== notified) {
    notified = next.latest;
    notifyInbox(
      `app-update:${next.latest}`,
      `Доступен Projector ${next.latest}`,
      "Обновление ставится командой npm, затем нужен restart. Терминалы и ходы агентов завершатся.",
      `${deviceBase()}/settings?section=about`,
    );
  }
  return next;
}

async function run(task: () => Promise<AppUpdateSnapshot>): Promise<AppUpdateSnapshot> {
  if (busy.value) throw new Error("Проверка обновления уже выполняется");
  busy.value = true;
  error.value = "";
  try {
    return apply(await task());
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось проверить обновление";
    throw err;
  } finally {
    busy.value = false;
  }
}

export const appUpdateInboxPending = () => snapshot.value?.inbox === true;

export function useAppUpdate() {
  return {
    snapshot,
    busy,
    error,
    offer: computed(() => snapshot.value?.offer === true),
    inbox: computed(() => snapshot.value?.inbox === true),
    command: computed(() => snapshot.value?.command ?? ""),
  };
}

export async function initAppUpdate(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const current = apply(await readAppUpdate());
    if (!current.checkedAt && current.source !== "checkout") await checkAppUpdateNow();
  } catch {
    // The About page can retry; startup must not fail because npm is unreachable.
  }
}

export function checkAppUpdateNow(): Promise<AppUpdateSnapshot> {
  return run(() => checkAppUpdate());
}

export function dismissAppUpdateNow(version?: string): Promise<AppUpdateSnapshot> {
  const latest = version?.trim() || snapshot.value?.latest;
  return run(() => dismissAppUpdate(latest));
}

export async function copyUpdateCommand(): Promise<string> {
  const command = snapshot.value?.command;
  if (!command) throw new Error("Команда обновления ещё не известна. Сначала проверьте registry.");
  await navigator.clipboard.writeText(command);
  return command;
}
