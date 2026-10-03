/**
 * Модель раскладки блоков в стиле VS Code: дерево разделителей (`split`) и групп вкладок (`group`).
 * Все операции чистые: принимают раскладку и возвращают новую (или ту же ссылку, если ничего не изменилось).
 * Панели — непрозрачные строковые id; смысл им придаёт вызывающий код. Каждая панель находится ровно в одной группе.
 */
export type DockDirection = "row" | "column";
export type DockEdge = "left" | "right" | "top" | "bottom";
export type DockZone = "center" | DockEdge;

export interface DockGroup {
  type: "group";
  id: string;
  panels: string[];
  active: string;
  /** Подсказка назначения («editor», «terminal»): помогает выбрать группу для новой панели. */
  role?: string;
  hidden?: boolean;
  /** Пустая группа не удаляется, а показывает подсказку. */
  keepEmpty?: boolean;
}
export interface DockSplit {
  type: "split";
  id: string;
  direction: DockDirection;
  children: DockNode[];
  /** Доли детей; в сумме 1. Скрытые дети сохраняют свою долю. */
  sizes: number[];
}
export type DockNode = DockGroup | DockSplit;
export interface DockLayout {
  root: DockNode;
  focused: string;
  /** Только на время сессии: развёрнутая на весь док группа. */
  maximized?: string;
}
/**
 * Куда поместить панель. `groupId` + `zone: center` — вкладка в группу (на позицию `index`);
 * `groupId` + край — разделить эту группу; край без `groupId` — разделить весь док.
 */
export interface DockTarget {
  groupId?: string;
  zone?: DockZone;
  index?: number;
}
