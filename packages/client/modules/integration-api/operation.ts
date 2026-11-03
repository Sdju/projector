import { ref } from "vue";

/** Shared lifecycle for integration requests, including the initial status load. */
export function useIntegrationOperation() {
  const busy = ref(false);
  const error = ref("");
  const message = ref("");
  async function action(task: () => Promise<void>) {
    if (busy.value) return;
    error.value = "";
    message.value = "";
    busy.value = true;
    try {
      await task();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка интеграции";
      throw err;
    } finally {
      busy.value = false;
    }
  }
  return { busy, error, message, action };
}
