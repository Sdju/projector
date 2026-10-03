import { shallowRef } from "vue";

export type NoticeKind = "success" | "error";
export type NoticeAnchor = Element | { x: number; y: number } | null | undefined;
export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
  /** Точка привязки в координатах окна; тултип появляется над ней. */
  x: number;
  y: number;
  /** Высота привязанного элемента: от неё зависит отступ тултипа. */
  height: number;
}

/**
 * Информационные тултипы: вместо уведомлений сообщают о результате действия рядом с тем,
 * что его вызвало. Успех исчезает сам, ошибка держится дольше и закрывается кликом.
 * Отображает их `UiNoticeHost`, подключённый один раз в корне приложения.
 */
export const notices = shallowRef<Notice[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let counter = 0;

function position(anchor: NoticeAnchor) {
  if (anchor instanceof Element && anchor.isConnected) {
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top, height: rect.height };
  }
  if (anchor && !(anchor instanceof Element)) return { ...anchor, height: 0 };
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return position(active);
  return { x: window.innerWidth / 2, y: window.innerHeight - 48, height: 0 };
}
export function dismissNotice(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  notices.value = notices.value.filter((notice) => notice.id !== id);
}
export function notify(
  anchor: NoticeAnchor,
  text: string,
  kind: NoticeKind = "success",
  duration = kind === "error" ? 5000 : 1600,
) {
  // Повторное действие на том же элементе заменяет тултип, а не копит стопку.
  const where = position(anchor);
  const stale = notices.value.filter(
    (notice) => Math.abs(notice.x - where.x) < 4 && Math.abs(notice.y - where.y) < 4,
  );
  stale.forEach((notice) => dismissNotice(notice.id));
  const id = ++counter;
  notices.value = [...notices.value.slice(-3), { id, kind, text, ...where }];
  timers.set(
    id,
    setTimeout(() => dismissNotice(id), duration),
  );
  return id;
}
/** Копирует текст и сообщает о результате у `anchor`. Возвращает успех, не бросает. */
export async function copyWithNotice(
  anchor: NoticeAnchor,
  text: string,
  success = "Скопировано",
  failure = "Не удалось скопировать",
) {
  try {
    await navigator.clipboard.writeText(text);
    notify(anchor, success);
    return true;
  } catch {
    notify(anchor, failure, "error");
    return false;
  }
}
