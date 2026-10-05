import type { VioElement } from "./core.ts";

/** Stable structural API; published declarations do not depend on local .gir files. */
export interface NativeObject {
  on(signal: string, callback: (...args: unknown[]) => unknown): unknown;
  off(signal: string, callback: (...args: unknown[]) => unknown): unknown;
  getProperty(name: string): unknown;
  setProperty(name: string, value: unknown): void;
}
export interface Widget extends NativeObject {
  getVisible(): boolean;
  setVisible(value: boolean): void;
  grabFocus(): boolean;
  getParent(): Widget | null;
  isAncestor(widget: Widget): boolean;
  addCssClass(name: string): void;
  removeCssClass(name: string): void;
}
export interface WindowWidget extends Widget {
  present(): void;
  hide(): void;
  destroy(): void;
  isActive(): boolean;
  getFocus(): Widget | null;
  getSurface(): object | null;
}
export interface EntryWidget extends Widget {
  getText(): string;
  setText(text: string): void;
  /** Позиция курсора в символах (`Gtk.Editable`). */
  getPosition(): number;
}
export interface RowWidget extends Widget {
  getIndex(): number;
}
export interface ListBoxWidget extends Widget {
  getRowAtIndex(index: number): RowWidget | null;
  getSelectedRow(): RowWidget | null;
  selectRow(row: RowWidget | null): void;
}
export interface ButtonWidget extends Widget {
  getLabel(): string;
  setLabel(label: string): void;
}
export interface LabelWidget extends Widget {
  getLabel(): string;
  setLabel(label: string): void;
}
export interface ToggleWidget extends Widget {
  getActive(): boolean;
  setActive(active: boolean): void;
}
export interface WidgetHandle<T extends object = Widget> {
  readonly element: VioElement | null;
  readonly widget: T | null;
}
