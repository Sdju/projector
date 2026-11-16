import { computed, ref } from "vue";

const active = ref(false);
const available = ref(false);

/** Zen-режим рабочей области: активная панель на всё окно без лишних блоков интерфейса. */
export const zenMode = computed(() => active.value);

/** Доступна ли команда переключения Zen-режима (активна при открытом рабочем пространстве). */
export const zenAvailable = computed(() => available.value);

export function setZenAvailable(value: boolean): void {
  available.value = value;
  if (!value) active.value = false;
}

export function setZenMode(value: boolean): void {
  active.value = value;
}

export function toggleZenMode(value?: boolean): boolean {
  const next = typeof value === "boolean" ? value : !active.value;
  setZenMode(next);
  return active.value;
}
