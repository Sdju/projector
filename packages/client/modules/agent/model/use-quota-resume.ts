import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  fetchRunsFeed,
  quotaResumeTurn,
  setChatResume,
  type AgentTurn,
} from "../../agent-core/index.ts";

/**
 * Plans "continue" for the answer that stopped on a usage limit. The plan is stored on the server,
 * so it survives a reload; this page also keeps a timer and sends first when it is open.
 */
export function useQuotaResume(options: {
  chat: string;
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  continueTurn: () => Promise<void>;
  fail?: (message: string) => void;
}) {
  const scheduledId = ref<string | null>(null);
  const scheduledAt = ref(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const target = computed(() => quotaResumeTurn(options.turns.value));
  const available = computed(() => !!target.value && !options.busy.value);
  const scheduled = computed(
    () => scheduledId.value !== null && scheduledId.value === target.value?.id,
  );

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function cancel() {
    scheduledId.value = null;
    scheduledAt.value = 0;
    clearTimer();
  }

  function arm() {
    clearTimer();
    if (scheduledId.value === null) return;
    // Browsers cap a timeout at 24.8 days; a longer reset re-arms on the next pass.
    const delay = Math.min(Math.max(0, scheduledAt.value - Date.now()), 2_147_000_000);
    timer = setTimeout(() => void fire(), delay);
  }

  async function fire() {
    if (scheduledId.value === null) return;
    if (Date.now() < scheduledAt.value) {
      arm();
      return;
    }
    const id = scheduledId.value;
    // A new message replaced the failed answer: the plan is no longer about the chat.
    if (target.value?.id !== id || options.busy.value) {
      cancel();
      return;
    }
    cancel();
    // The server waits a grace period; clearing the plan first keeps it from sending twice.
    void setChatResume(options.chat, false).catch(() => {});
    await options.continueTurn().catch(() => {});
  }

  async function toggle() {
    if (scheduled.value) {
      cancel();
      await setChatResume(options.chat, false).catch((cause: unknown) =>
        options.fail?.(cause instanceof Error ? cause.message : "Не удалось отменить продолжение"),
      );
      return;
    }
    const turn = target.value;
    if (!turn?.failureInfo?.resetAt || options.busy.value) return;
    try {
      const plan = await setChatResume(options.chat, true);
      if (!plan) throw new Error("Сервер не сохранил продолжение");
      scheduledId.value = turn.id;
      scheduledAt.value = plan.at;
      arm();
    } catch (cause) {
      options.fail?.(
        cause instanceof Error ? cause.message : "Не удалось запланировать продолжение",
      );
    }
  }

  /** A reloaded page takes the plan from the server and offers the same countdown. */
  async function loadPlan() {
    const feed = await fetchRunsFeed().catch(() => undefined);
    const plan = feed?.recent.find((item) => item.chat === options.chat)?.resume;
    const turn = target.value;
    if (!plan?.auto || !turn || plan.at <= Date.now()) return;
    scheduledId.value = turn.id;
    scheduledAt.value = plan.at;
    arm();
  }
  void loadPlan();

  // The tab can sleep through the deadline: check again as soon as it is visible.
  const onVisible = () => {
    if (scheduledId.value === null) return;
    if (Date.now() >= scheduledAt.value) void fire();
    else arm();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  watch(target, (turn) => {
    if (scheduledId.value !== null && turn?.id !== scheduledId.value) cancel();
  });
  watch(options.busy, (busy) => {
    if (busy) cancel();
  });
  onBeforeUnmount(() => {
    cancel();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisible);
  });

  return { available, scheduled, scheduledId, toggle, cancel };
}

/** Positional form keeps the chat component under its line budget. */
export function useChatQuotaResume(
  chat: string,
  turns: Ref<AgentTurn[]>,
  busy: Ref<boolean>,
  continueTurn: () => Promise<void>,
  fail: (message: string) => void,
) {
  return useQuotaResume({ chat, turns, busy, continueTurn, fail });
}
