import { inject, provide, shallowRef, type InjectionKey, type ShallowRef } from "vue";

/** Контейнер действий в верхней панели вкладки: сюда редакторы телепортируют свои элементы. */
export type EditorTopbarTarget = ShallowRef<HTMLElement | null>;

const editorTopbarKey: InjectionKey<EditorTopbarTarget> = Symbol("editor-topbar");

/** Создаёт точку вставки верхней панели вкладки и отдаёт её потомкам. */
export function provideEditorTopbar(): EditorTopbarTarget {
  const target = shallowRef<HTMLElement | null>(null);
  provide(editorTopbarKey, target);
  return target;
}

/** Точка вставки ближайшей вкладки; вне вкладки её нет, и элементы не показываются. */
export function useEditorTopbarTarget(): EditorTopbarTarget | null {
  return inject(editorTopbarKey, null);
}
