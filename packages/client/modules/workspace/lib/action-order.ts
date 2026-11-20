import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";

const orders = ref<Record<string, string[]>>({});
let loading: Promise<void> | undefined;
let writes = Promise.resolve();

function loadOrders() {
  loading ??= fetch("/api/ide/action-order")
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить порядок кнопок");
      orders.value = await response.json();
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

/** Reorder only the slots occupied by the items on this panel. */
export function reorderVisible(
  order: string[],
  visible: string[],
  from: string,
  to: string,
  after: boolean,
): string[] {
  const shown = new Set(visible);
  const reordered = order.filter((id) => shown.has(id) && id !== from);
  reordered.splice(reordered.indexOf(to) + Number(after), 0, from);
  let index = 0;
  return order.map((id) => (shown.has(id) ? reordered[index++]! : id));
}

export function useActionOrder(scope: MaybeRefOrGetter<string>) {
  void loadOrders().catch(console.error);
  const order = computed(() => orders.value[toValue(scope)] ?? []);
  function sort<T>(items: T[], id: (item: T) => string): T[] {
    return [...items].sort((a, b) => {
      const ai = order.value.indexOf(id(a));
      const bi = order.value.indexOf(id(b));
      return (ai < 0 ? order.value.length : ai) - (bi < 0 ? order.value.length : bi);
    });
  }
  async function move(ids: string[], from: string, to: string, after: boolean, all = ids) {
    if (from === to || !ids.includes(from) || !ids.includes(to)) return;
    await update((saved) => {
      // Keep unavailable and hidden entries in the saved order.
      const merged = [...new Set([...saved, ...all])];
      return reorderVisible(merged, ids, from, to, after);
    });
  }
  async function update(change: (saved: string[]) => string[] | undefined) {
    const key = toValue(scope);
    const pending = writes.then(async () => {
      await loadOrders();
      const ids = change(orders.value[key] ?? []);
      if (!ids) return;
      const response = await fetch("/api/ide/action-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: key, ids }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить порядок кнопок");
      orders.value = { ...orders.value, [key]: ids };
    });
    writes = pending.catch((error: unknown) => {
      console.error(error);
    });
    await pending;
  }
  return { load: loadOrders, order, sort, move, update };
}
