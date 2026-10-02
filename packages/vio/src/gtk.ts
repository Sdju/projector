import Gtk from "gi:Gtk-4.0";
import Gdk from "gi:Gdk-4.0";
import Pango from "gi:Pango-1.0";
import { normalizeClass, normalizeStyle } from "@vue/runtime-core";
import { toKebab, type VioDriver, type VioElement, type VioNode } from "./core.ts";
import type { NativeObject, Widget } from "./types.ts";

export type ChildrenMode = "none" | "box" | "single" | "list" | "grid" | "stack" | "text";
export interface WidgetDefinition { create: () => object; children?: ChildrenMode; controller?: boolean }
const definitions = new Map<string, WidgetDefinition>([
  ["window", { create: () => new Gtk.Window(), children: "single" }],
  ["box", { create: () => new Gtk.Box(), children: "box" }],
  ["label", { create: () => new Gtk.Label(), children: "text" }],
  ["entry", { create: () => new Gtk.Entry() }],
  ["button", { create: () => new Gtk.Button(), children: "single" }],
  ["image", { create: () => new Gtk.Image() }],
  ["list-box", { create: () => new Gtk.ListBox(), children: "list" }],
  ["list-box-row", { create: () => new Gtk.ListBoxRow(), children: "single" }],
  ["scrolled-window", { create: () => new Gtk.ScrolledWindow(), children: "single" }],
  ["grid", { create: () => new Gtk.Grid(), children: "grid" }],
  ["stack", { create: () => new Gtk.Stack(), children: "stack" }],
  ["separator", { create: () => new Gtk.Separator() }],
  ["spinner", { create: () => new Gtk.Spinner() }],
  ["switch", { create: () => new Gtk.Switch() }],
  ["check-button", { create: () => new Gtk.CheckButton(), children: "single" }],
  ["key-controller", { create: () => new Gtk.EventControllerKey(), controller: true }],
]);

/** Extend vio with an introspected GTK/Adwaita class without changing its reconciler. */
export function registerWidget(type: string, definition: WidgetDefinition) {
  if (definitions.has(type)) throw new Error(`vio: widget '${type}' is already registered`);
  definitions.set(type, definition);
}

export function installCss(css: string): () => void {
  const display = Gdk.Display.getDefault();
  if (!display) throw new Error("vio: GTK has no display; call Gtk.init() in a desktop session first");
  const provider = new Gtk.CssProvider();
  // GTK otherwise logs parsing errors and continues with a partially applied sheet.
  let parsingError: Error | undefined;
  provider.on("parsing-error", (_section: unknown, error: Error) => { parsingError = error; });
  provider.loadFromString(css);
  if (parsingError) throw new Error(`vio: invalid GTK CSS: ${parsingError.message}`);
  Gtk.StyleContext.addProviderForDisplay(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  return () => Gtk.StyleContext.removeProviderForDisplay(display, provider);
}

interface State { defaults: Map<string, unknown>; classes: Set<string>; originalClasses: Set<string>; removeStyle?: () => void; styleId?: string }
const states = new WeakMap<VioNode, State>();
let styleCounter = 0;
const native = (node: VioNode) => node.widget as NativeObject;
const widget = (node: VioNode) => node.widget as Widget;
const stateOf = (node: VioNode) => {
  let state = states.get(node);
  if (!state) { state = { defaults: new Map(), classes: new Set(), originalClasses: new Set((node.widget instanceof Gtk.Widget) ? node.widget.getCssClasses() : []) }; states.set(node, state); }
  return state;
};
const childMode = (node: VioElement): ChildrenMode => {
  if (node.kind !== "root") return definitions.get(node.type)?.children ?? "none";
  if (!node.widget) return "none";
  if (node.widget instanceof Gtk.Box) return "box";
  if (node.widget instanceof Gtk.ListBox) return "list";
  if (node.widget instanceof Gtk.Grid) return "grid";
  return "single";
};
const concreteChildren = (node: VioElement) => node.children.filter(child => child.widget && !definitions.get(child.type)?.controller);
const isController = (node: VioNode) => Boolean(definitions.get(node.type)?.controller);
const applySelection = (parent: VioElement) => {
  if (parent.widget instanceof Gtk.ListBox && parent.props.selected !== undefined) {
    parent.widget.selectRow(parent.widget.getRowAtIndex(Number(parent.props.selected)));
  }
};
const labelText = (parent: VioElement) => (parent.widget as InstanceType<typeof Gtk.Label>).setLabel(parent.children.map(child => child.text).join(""));
const enumValues: Record<string, Record<string, number>> = {
  orientation: { horizontal: Gtk.Orientation.HORIZONTAL, vertical: Gtk.Orientation.VERTICAL },
  selectionMode: { none: Gtk.SelectionMode.NONE, single: Gtk.SelectionMode.SINGLE, browse: Gtk.SelectionMode.BROWSE, multiple: Gtk.SelectionMode.MULTIPLE },
  halign: { fill: Gtk.Align.FILL, start: Gtk.Align.START, end: Gtk.Align.END, center: Gtk.Align.CENTER, baseline: Gtk.Align.BASELINE },
  valign: { fill: Gtk.Align.FILL, start: Gtk.Align.START, end: Gtk.Align.END, center: Gtk.Align.CENTER, baseline: Gtk.Align.BASELINE },
  ellipsize: { none: Pango.EllipsizeMode.NONE, start: Pango.EllipsizeMode.START, middle: Pango.EllipsizeMode.MIDDLE, end: Pango.EllipsizeMode.END },
  propagationPhase: { none: Gtk.PropagationPhase.NONE, capture: Gtk.PropagationPhase.CAPTURE, bubble: Gtk.PropagationPhase.BUBBLE, target: Gtk.PropagationPhase.TARGET },
  hscrollbarPolicy: { always: Gtk.PolicyType.ALWAYS, automatic: Gtk.PolicyType.AUTOMATIC, never: Gtk.PolicyType.NEVER, external: Gtk.PolicyType.EXTERNAL },
  vscrollbarPolicy: { always: Gtk.PolicyType.ALWAYS, automatic: Gtk.PolicyType.AUTOMATIC, never: Gtk.PolicyType.NEVER, external: Gtk.PolicyType.EXTERNAL },
};

export const gtkDriver: VioDriver = {
  isAnchor: node => !isController(node),
  create(type) {
    const definition = definitions.get(type);
    if (!definition) throw new Error(`vio: unknown widget '${type}'; use a V* component, gtk-* element or registerWidget()`);
    return definition.create();
  },
  createText: text => new Gtk.Label({ label: text, xalign: 0 }),
  insert(node, parent, before) {
    if (parent.kind === "root" && !parent.widget) {
      if (isController(node)) throw new Error("vio: an event controller must belong to a widget");
      return;
    }
    if (isController(node)) {
      if (!(parent.widget instanceof Gtk.Widget)) throw new Error("vio: controller parent is not a Gtk.Widget");
      const controller = node.widget as InstanceType<typeof Gtk.EventController>;
      if (controller.getWidget() !== parent.widget) parent.widget.addController(controller);
      return;
    }
    const mode = childMode(parent);
    if (mode === "text") {
      if (node.kind !== "text") throw new Error("vio: labels accept text, not nested GTK widgets");
      labelText(parent); return;
    }
    if (mode === "none") throw new Error(`vio: '${parent.type}' cannot contain children`);
    const child = node.widget as InstanceType<typeof Gtk.Widget>;
    if (mode === "box") {
      const box = parent.widget as InstanceType<typeof Gtk.Box>;
      const children = concreteChildren(parent);
      const position = children.indexOf(node);
      const previous = position > 0 ? children[position - 1]!.widget as InstanceType<typeof Gtk.Widget> : null;
      if (child.getParent() === box) box.reorderChildAfter(child, previous);
      else box.insertChildAfter(child, previous);
    } else if (mode === "list") {
      if (!(child instanceof Gtk.ListBoxRow)) throw new Error("vio: VListBox children must be VListBoxRow components");
      const list = parent.widget as InstanceType<typeof Gtk.ListBox>;
      if (child.getParent() === list) list.remove(child);
      const index = before ? (before as InstanceType<typeof Gtk.ListBoxRow>).getIndex() : -1;
      list.insert(child, index);
      applySelection(parent);
    } else if (mode === "single") {
      if (concreteChildren(parent).length > 1) throw new Error(`vio: '${parent.type}' accepts one widget child; wrap siblings in VBox`);
      (parent.widget as InstanceType<typeof Gtk.Window>).setChild(child);
    } else if (mode === "grid") {
      const grid = parent.widget as InstanceType<typeof Gtk.Grid>;
      if (child.getParent() === grid) grid.remove(child);
      grid.attach(child, Number(node.props.column ?? 0), Number(node.props.row ?? concreteChildren(parent).indexOf(node)), Number(node.props.columnSpan ?? 1), Number(node.props.rowSpan ?? 1));
    } else if (mode === "stack") {
      const stack = parent.widget as InstanceType<typeof Gtk.Stack>;
      if (child.getParent() !== stack) stack.addNamed(child, String(node.props.name ?? `page-${concreteChildren(parent).indexOf(node)}`));
    }
  },
  remove(node, parent) {
    if (parent.kind === "root" && !parent.widget) return;
    if (isController(node)) {
      (parent.widget as InstanceType<typeof Gtk.Widget>).removeController(node.widget as InstanceType<typeof Gtk.EventController>); return;
    }
    const mode = childMode(parent);
    if (mode === "text") {
      (parent.widget as InstanceType<typeof Gtk.Label>).setLabel(parent.children.filter(child => child !== node).map(child => child.text).join("")); return;
    }
    const child = node.widget as InstanceType<typeof Gtk.Widget>;
    if (!child.getParent()) return;
    if (mode === "single") (parent.widget as InstanceType<typeof Gtk.Window>).setChild(null);
    else if (mode === "box") (parent.widget as InstanceType<typeof Gtk.Box>).remove(child);
    else if (mode === "list") (parent.widget as InstanceType<typeof Gtk.ListBox>).remove(child);
    else if (mode === "grid") (parent.widget as InstanceType<typeof Gtk.Grid>).remove(child);
    else if (mode === "stack") (parent.widget as InstanceType<typeof Gtk.Stack>).remove(child);
  },
  patchProp(node, key, _previous, value) {
    const state = stateOf(node);
    if (key === "class") {
      const classes = new Set(normalizeClass(value).split(/\s+/).filter(Boolean));
      for (const name of state.classes) if (!classes.has(name) && !state.originalClasses.has(name)) widget(node).removeCssClass(name);
      for (const name of classes) if (!state.classes.has(name)) widget(node).addCssClass(name);
      state.classes = classes; return;
    }
    if (key === "style") {
      state.removeStyle?.(); state.removeStyle = undefined;
      if (value) {
        state.styleId ??= `vio-style-${++styleCounter}`;
        widget(node).addCssClass(state.styleId);
        const style = normalizeStyle(value);
        const css = typeof style === "string" ? style : Object.entries(style ?? {}).map(([name, value]) => `${toKebab(name)}: ${value}`).join("; ");
        state.removeStyle = installCss(`.${state.styleId} { ${css} }`);
      }
      return;
    }
    if (key === "selected" && node.type === "list-box") { applySelection(node); return; }
    if (["column", "row", "columnSpan", "rowSpan"].includes(key)) {
      if (node.parent && childMode(node.parent) === "grid") gtkDriver.insert(node, node.parent, null);
      return;
    }
    const camelKey = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (typeof value === "string" && enumValues[camelKey]) {
      if (!(value in enumValues[camelKey]!)) throw new Error(`vio: unknown ${key} value '${value}'`);
      value = enumValues[camelKey]![value];
    }
    const property = key === "id" ? "name" : toKebab(camelKey);
    if (!state.defaults.has(property)) state.defaults.set(property, native(node).getProperty(property));
    const next = value == null ? state.defaults.get(property) : value;
    if (native(node).getProperty(property) !== next) native(node).setProperty(property, next);
  },
  setText(node, text) {
    (node.widget as InstanceType<typeof Gtk.Label>).setLabel(text);
    if (node.parent && childMode(node.parent) === "text") labelText(node.parent);
  },
  setElementText(node, text) {
    if (node.widget instanceof Gtk.Label || node.widget instanceof Gtk.Button || node.widget instanceof Gtk.CheckButton) { node.widget.setLabel(text); return true; }
    return false;
  },
  connect(node, signal, callback) { native(node).on(signal, callback); return () => { if (node.widget) native(node).off(signal, callback); }; },
  setScopeId: (node, id) => { if (node.widget instanceof Gtk.Widget) node.widget.addCssClass(id); },
  dispose(node) { states.get(node)?.removeStyle?.(); states.delete(node); if (node.widget instanceof Gtk.Window) node.widget.destroy(); },
};
