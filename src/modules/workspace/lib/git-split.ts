/** Ниже этой высоты история при перетаскивании границы сворачивается. */
export const HISTORY_COLLAPSE = 72;
/** Минимальная высота раскрытой истории вместе с заголовком. */
export const HISTORY_MIN = 120;
/** Столько места всегда остаётся блокам Staged и Changed. */
export const CHANGES_MIN = 96;

export interface HistoryResize {
  height: number;
  /** История сжата ниже порога: её нужно свернуть, высоту не менять. */
  collapse?: true;
}

/**
 * Высота истории при перетаскивании границы: движение вверх увеличивает её, вниз уменьшает.
 * Между порогом схлопывания и минимумом история держится на минимуме, выше предела — на пределе.
 */
export function resizeHistory(start: number, stack: number, delta: number): HistoryResize {
  const next = start - delta;
  if (next < HISTORY_COLLAPSE) return { height: start, collapse: true };
  const max = Math.max(HISTORY_MIN, stack - CHANGES_MIN);
  return { height: Math.min(max, Math.max(HISTORY_MIN, next)) };
}
