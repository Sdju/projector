import { ref } from "vue";

const orders = ref<Record<string, string[]>>({});
let loading: Promise<void> | undefined;
let writes = Promise.resolve();

export function useActionOrder(scope: string) {
  loading ??= fetch("/api/ide/action-order")
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить порядок кнопок");
      orders.value = await response.json();
    })
    .catch((error: unknown) => {
      console.error(error);
    });
  function sort<T>(items: T[], id: (item: T) => string): T[] {
    const order = orders.value[scope] ?? [];
    return [...items].sort((a, b) => {
      const ai = order.indexOf(id(a));
      const bi = order.indexOf(id(b));
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
  }
  async function move(ids: string[], from: string, to: string, after: boolean) {
    if (from === to || !ids.includes(from) || !ids.includes(to)) return;
    await loading;
    // Keep unavailable and hidden entries in the saved order.
    const saved = orders.value[scope] ?? [];
    const merged = [...saved.filter((id) => !ids.includes(id)), ...ids];
    merged.splice(merged.indexOf(from), 1);
    merged.splice(merged.indexOf(to) + (after ? 1 : 0), 0, from);
    orders.value = { ...orders.value, [scope]: merged };
    const pending = writes.then(async () => {
      const response = await fetch("/api/ide/action-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, ids: merged }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить порядок кнопок");
    });
    writes = pending.catch((error: unknown) => {
      console.error(error);
    });
    await pending;
  }
  return { sort, move };
}
