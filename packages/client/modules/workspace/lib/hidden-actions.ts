import { ref } from "vue";

const hidden = ref<string[]>([]);
const error = ref("");
let loading: Promise<void> | undefined;
let writes = Promise.resolve();

async function readHidden(response: Response): Promise<string[]> {
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("hidden" in data) ||
    !Array.isArray(data.hidden) ||
    data.hidden.some((id: unknown) => typeof id !== "string")
  )
    throw new Error("Некорректный список скрытых действий");
  return data.hidden;
}

export function useHiddenActions() {
  loading ??= fetch("/api/ide/hidden-actions")
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить скрытые действия");
      hidden.value = await readHidden(response);
    })
    .catch((reason: unknown) => {
      error.value = String(reason);
    });

  async function setHidden(id: string, value: boolean) {
    await loading;
    const pending = writes.then(async () => {
      const response = await fetch("/api/ide/hidden-actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hidden: value }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить скрытые действия");
      hidden.value = await readHidden(response);
      error.value = "";
    });
    writes = pending.catch((reason: unknown) => {
      error.value = String(reason);
    });
    await pending;
  }
  return { hidden, error, setHidden };
}
