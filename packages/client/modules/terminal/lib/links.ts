import type { Terminal, IDisposable } from "@xterm/xterm";

export interface TerminalLink {
  text: string;
  path: string;
  start: number;
  end: number;
  line?: number;
  column?: number;
  web?: boolean;
}

export function terminalLinks(text: string): TerminalLink[] {
  const links: TerminalLink[] = [];
  // Quotes allow spaces in filenames. The buffer has already removed ANSI escapes.
  const tokens =
    /(["'`])([^\r\n]*?)\1(?::\d+(?::\d+)?|\(\d+(?:,\s*\d+)?\))?|[^\s"'`<>|]+?\(\d+,\s*\d+\)|[^\s"'`<>|]+/g;
  for (const match of text.matchAll(tokens)) {
    let value = match[0];
    let start = match.index!;
    if (match[1]) {
      value = match[2]! + value.slice(match[2]!.length + 2);
      start++;
    } else {
      const prefix = value.match(/^[([{]+/)?.[0] ?? "";
      start += prefix.length;
      value = value.slice(prefix.length).replace(/[\],;.!?]+$/, "");
      // Preserve the parentheses in compiler locations: file.ts(12,3).
      if (!/\(\d+(?:,\s*\d+)?\)$/.test(value)) value = value.replace(/[)}]+$/, "");
    }
    const end = match[1] ? match.index! + match[0].length : start + value.length;
    if (/^https?:\/\/[^\s]+$/i.test(value)) {
      links.push({ text: value, path: value, start, end, web: true });
      continue;
    }
    const location = value.match(
      /(?::([1-9]\d*)(?::([1-9]\d*))?|\(([1-9]\d*)(?:,\s*([1-9]\d*))?\))$/,
    );
    let path = location ? value.slice(0, location.index) : value.replace(/:$/, "");
    if (path.startsWith("file://")) {
      try {
        const url = new URL(path);
        if (url.hostname && url.hostname !== "localhost") continue;
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    }
    if (!path || /[\x00-\x1f\x7f]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) continue;
    const filename =
      /^[\p{L}_@.-][\p{L}\p{N}_@ .-]*\.[\p{L}\p{N}_-]+$/u.test(path) ||
      /^\.[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(path) ||
      /^(?:Dockerfile|Containerfile|Makefile|CMakeLists.txt|LICENSE|README|CHANGELOG|NOTICE)$/.test(
        path,
      );
    if (!/\//.test(path) && !filename) continue;
    if (path === "/" || /^(?:\.{1,2}\/|~\/)?$/.test(path) || path.startsWith("//")) continue;
    links.push({
      text: value,
      path,
      start,
      end,
      line: location ? Number(location[1] ?? location[3]) : undefined,
      column: location?.[2] || location?.[4] ? Number(location[2] ?? location[4]) : undefined,
    });
  }
  return links;
}

interface CellPosition {
  x: number;
  y: number;
  width: number;
}
interface HoverLink {
  link: TerminalLink;
  cells: CellPosition[];
}

// Only read the logical buffer line under the pointer, including soft wraps.
// Bounds keep huge minified lines from turning a hover into a history scan.
function linkAt(terminal: Terminal, x: number, y: number): HoverLink | undefined {
  const buffer = terminal.buffer.active;
  const row = buffer.viewportY + y;
  let first = row;
  while (first > 0 && buffer.getLine(first)?.isWrapped && row - first < 32) first--;
  if (buffer.getLine(first)?.isWrapped) return;
  let text = "";
  const positions: CellPosition[] = [];
  let offset = -1;
  for (let current = first; current < buffer.length && current - first < 32; current++) {
    const line = buffer.getLine(current);
    if (!line || (current > first && !line.isWrapped)) break;
    const wrapped = buffer.getLine(current + 1)?.isWrapped;
    for (let col = 0; col < terminal.cols; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      if (current === row && x >= col && x < col + cell.getWidth()) offset = text.length;
      const chars = cell.getChars() || " ";
      text += chars;
      for (let n = 0; n < chars.length; n++)
        positions.push({ x: col, y: current - buffer.viewportY, width: cell.getWidth() });
    }
    if (!wrapped) break;
    if (current - first === 31) return;
    if (text.length > 16384) return;
  }
  if (offset < 0) return;
  const link = terminalLinks(text).find((link) => offset >= link.start && offset < link.end);
  return link ? { link, cells: positions.slice(link.start, link.end) } : undefined;
}

export function bindTerminalLinks(
  terminal: Terminal,
  open: (link: TerminalLink) => void,
): IDisposable {
  const element = terminal.element!;
  const screen = element.querySelector<HTMLElement>(".xterm-screen")!;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5";
  screen.append(overlay);
  const originalCursor = screen.style.cursor;
  let pointer: { x: number; y: number } | undefined;
  let ctrl = false;
  let hovered: HoverLink | undefined;
  let pressed: TerminalLink | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true;
  let previousCell = "";
  function linkUnderPointer(event: MouseEvent): HoverLink | undefined {
    const rect = screen.getBoundingClientRect();
    const width = rect.width / terminal.cols;
    const height = rect.height / terminal.rows;
    const x = Math.floor((event.clientX - rect.left) / width);
    const y = Math.floor((event.clientY - rect.top) / height);
    if (x < 0 || y < 0 || x >= terminal.cols || y >= terminal.rows) return;
    return linkAt(terminal, x, y);
  }
  function clear() {
    clearTimeout(timer);
    timer = undefined;
    hovered = undefined;
    previousCell = "";
    overlay.replaceChildren();
    screen.style.cursor = originalCursor;
    overlay.removeAttribute("aria-label");
  }
  function refresh(force = false) {
    clearTimeout(timer);
    timer = undefined;
    if (!ctrl || !pointer) {
      clear();
      return;
    }
    const rect = screen.getBoundingClientRect();
    const width = rect.width / terminal.cols;
    const height = rect.height / terminal.rows;
    const x = Math.floor((pointer.x - rect.left) / width);
    const y = Math.floor((pointer.y - rect.top) / height);
    if (x < 0 || y < 0 || x >= terminal.cols || y >= terminal.rows) {
      clear();
      return;
    }
    const cell = `${x}:${y}:${terminal.buffer.active.viewportY}`;
    if (!force && !dirty && cell === previousCell) return;
    previousCell = cell;
    dirty = false;
    hovered = linkAt(terminal, x, y);
    overlay.replaceChildren();
    screen.style.cursor = hovered ? "pointer" : originalCursor;
    if (!hovered) return;
    const rows = new Map<number, { first: number; last: number }>();
    for (const cell of hovered.cells) {
      const row = rows.get(cell.y);
      if (row) row.last = Math.max(row.last, cell.x + cell.width - 1);
      else rows.set(cell.y, { first: cell.x, last: cell.x + cell.width - 1 });
    }
    for (const [row, range] of rows) {
      const underline = document.createElement("div");
      underline.style.cssText = `position:absolute;left:${range.first * width}px;top:${(row + 1) * height - 1}px;width:${(range.last - range.first + 1) * width}px;border-bottom:1px solid currentColor`;
      overlay.append(underline);
    }
  }
  function schedule() {
    if (ctrl && pointer && !timer) timer = setTimeout(() => refresh(), 16);
  }
  function move(event: MouseEvent) {
    pointer = { x: event.clientX, y: event.clientY };
    ctrl = event.ctrlKey && !event.shiftKey && !event.altKey;
    if (ctrl) schedule();
    else if (hovered) clear();
  }
  function leave() {
    pointer = undefined;
    ctrl = false;
    clear();
  }
  function blur() {
    leave();
    pressed = undefined;
  }
  function key(event: KeyboardEvent) {
    const enabled = event.ctrlKey && !event.shiftKey && !event.altKey;
    if (enabled === ctrl) return;
    ctrl = enabled;
    if (ctrl) schedule();
    else clear();
  }
  function down(event: MouseEvent) {
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    move(event);
    const target = linkUnderPointer(event);
    if (!target || (!event.ctrlKey && !target.link.web)) return;
    if (event.ctrlKey) refresh(true);
    pressed = target.link;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function up(event: MouseEvent) {
    if (!pressed) return;
    const link = pressed;
    pressed = undefined;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    move(event);
    const target = linkUnderPointer(event);
    if (target?.link.path === link.path && target.link.start === link.start) open(link);
  }
  const bindings: [EventTarget, string, EventListener, boolean][] = [
    [element, "mousemove", move as EventListener, true],
    [element, "mouseleave", leave, false],
    [element, "mousedown", down as EventListener, true],
    [window, "mouseup", up as EventListener, true],
    [window, "keydown", key as EventListener, true],
    [window, "keyup", key as EventListener, true],
    [window, "blur", blur, false],
  ];
  for (const [target, type, handler, capture] of bindings)
    target.addEventListener(type, handler, capture);
  const changed = () => {
    dirty = true;
    schedule();
  };
  const render = terminal.onRender(changed);
  const scroll = terminal.onScroll(changed);
  const resize = terminal.onResize(changed);
  return {
    dispose() {
      clearTimeout(timer);
      render.dispose();
      scroll.dispose();
      resize.dispose();
      for (const [target, type, handler, capture] of bindings)
        target.removeEventListener(type, handler, capture);
      clear();
      overlay.remove();
    },
  };
}
