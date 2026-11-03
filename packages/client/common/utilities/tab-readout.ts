import { inject, onBeforeUnmount, provide, type InjectionKey } from "vue";

/**
 * Что view служебной вкладки показывает штатному агенту: текстовое описание
 * текущего состояния (выбор, фильтры, загруженные данные). `note` — короткая
 * подпись, как у `TabType.read`.
 */
export interface TabReadout {
  text?: string;
  note?: string;
}
export type TabReadoutSource = () => TabReadout | undefined;

/** Снапшоты по ключу вкладки: первый — владелец вкладки (её view), дальше вложенные view. */
const sources = new Map<string, TabReadoutSource[]>();

/** Ключ вкладки, под которым view публикует снапшот; задаёт обёртка вкладки. */
export const tabReadoutKey: InjectionKey<() => string> = Symbol("tab-readout");

/**
 * Снапшот вкладки, опубликованный смонтированным view. Владелец вкладки — источник,
 * зарегистрированный первым (обёртка вкладки регистрирует свой view раньше вложенных):
 * вложенная секция не подменяет снимок вкладки, но используется, если владелец ещё пуст.
 */
export function readTabReadout(key: string | undefined): TabReadout | undefined {
  const stack = key ? sources.get(key) : undefined;
  if (!stack) return undefined;
  for (const source of stack) {
    try {
      const readout = source();
      if (readout) return readout;
    } catch {
      // A broken reader must not hide the rest of the stack.
    }
  }
  return undefined;
}

/**
 * Публикует источник снапшота по ключу вкладки; возвращает снятие регистрации,
 * после которого снова виден предыдущий (внешний) источник.
 */
export function registerTabReadout(key: string, source: TabReadoutSource): () => void {
  const stack = sources.get(key) ?? [];
  stack.push(source);
  sources.set(key, stack);
  return () => {
    const current = sources.get(key);
    const index = current ? current.lastIndexOf(source) : -1;
    if (!current || index === -1) return;
    current.splice(index, 1);
    if (!current.length) sources.delete(key);
  };
}

/**
 * View публикует актуальный снапшот: источник вызывается на каждое чтение и
 * снимается при размонтировании. Вне обёртки вкладки (`tabReadoutKey` нет) — no-op.
 */
export function useTabReadout(source: TabReadoutSource): void {
  const key = inject(tabReadoutKey, undefined);
  if (!key) return;
  const dispose = registerTabReadout(key(), source);
  onBeforeUnmount(dispose);
}

/** Объявляет ключ вкладки, который увидят её view через `useTabReadout`. */
export function provideTabReadout(key: () => string): void {
  provide(tabReadoutKey, key);
}

/** Собирает снапшот из строк, пропуская пустые (удобно для условных полей). */
export function readoutLines(...lines: Array<string | false | undefined | null>): string {
  return lines.filter((line): line is string => !!line).join("\n");
}
