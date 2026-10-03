import { ref } from "vue";

/** Меньше этой высоты блок не сжимается при перетаскивании: дальше он сворачивается. */
export const BLOCK_COLLAPSE = 56;
/** Минимальная высота раскрытого блока вместе с заголовком. */
export const BLOCK_MIN = 84;

export interface PairResize {
  above: number;
  below: number;
  /** Блок, сжатый ниже порога: его нужно свернуть, а размеры не менять. */
  collapse?: "above" | "below";
}

/**
 * Перераспределяет высоту между двумя соседними блоками: сумма сохраняется.
 * Пока блок больше порога схлопывания, он не меньше минимума; ниже порога — сворачивается.
 */
export function resizePair(above: number, below: number, delta: number): PairResize {
  const total = above + below;
  const next = above + delta;
  if (next < BLOCK_COLLAPSE) return { above, below, collapse: "above" };
  if (total - next < BLOCK_COLLAPSE) return { above, below, collapse: "below" };
  const clamped = Math.min(total - BLOCK_MIN, Math.max(BLOCK_MIN, next));
  return { above: clamped, below: total - clamped };
}

/**
 * Состояние блоков вертикальной панели: какие свёрнуты и как раскрытые делят высоту.
 * Вес блока — его высота в пикселях на момент последнего перетаскивания; пока весов нет,
 * блоки занимают место по содержимому.
 */
export function useGitBlocks(order: string[], collapsedByDefault: string[] = []) {
  const collapsed = ref(new Set<string>(collapsedByDefault));
  const weights = ref<Record<string, number>>({});
  const expanded = () => order.filter((id) => !collapsed.value.has(id));
  function setCollapsed(id: string, value: boolean) {
    if (value) collapsed.value.add(id);
    else collapsed.value.delete(id);
  }
  function toggle(id: string) {
    setCollapsed(id, !collapsed.value.has(id));
  }
  /** Блок, с которым делит границу раскрытый `id`: следующий раскрытый ниже. */
  function neighbour(id: string) {
    const list = expanded();
    return list[list.indexOf(id) + 1];
  }
  /** Фиксирует текущие высоты раскрытых блоков как веса, чтобы дальше менять их попарно. */
  function pin(sizes: Record<string, number>) {
    for (const id of expanded()) if (sizes[id] !== undefined) weights.value[id] = sizes[id]!;
  }
  /** Применяет перетаскивание границы под `id`; возвращает false, если блок свернулся. */
  function resize(id: string, start: Record<string, number>, delta: number) {
    const below = neighbour(id);
    if (!below) return true;
    const result = resizePair(start[id]!, start[below]!, delta);
    if (result.collapse) {
      setCollapsed(result.collapse === "above" ? id : below, true);
      return false;
    }
    pin(start);
    weights.value[id] = result.above;
    weights.value[below] = result.below;
    return true;
  }
  function reset() {
    weights.value = {};
  }
  return { collapsed, weights, expanded, setCollapsed, toggle, neighbour, resize, reset };
}
export type GitBlocksState = ReturnType<typeof useGitBlocks>;
