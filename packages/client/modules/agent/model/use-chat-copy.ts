import { onBeforeUnmount, ref } from "vue";
import { copyText } from "../lib/clipboard.ts";

/** Копирование текста ответа с кратковременным подтверждением и очисткой таймера. */
export function useChatCopy() {
  const copied = ref("");
  const copyError = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copyMessage(id: string, text: string) {
    if (!(await copyText(text))) {
      copyError.value = "Не удалось скопировать ответ";
      return;
    }
    copied.value = id;
    copyError.value = "";
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = "";
    }, 2000);
  }

  onBeforeUnmount(() => clearTimeout(timer));
  return { copied, copyError, copyMessage };
}
