import { monaco } from "./monaco.ts";

/** Line-level change between the Git index and the editor model (VS Code "quick diff"). */
interface Change {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
}
type Kind = "added" | "modified" | "deleted";
export interface DirtyDiff {
  /** Index text to compare with; null disables the gutter (no repository or untracked file). */
  setOriginal(text: string | null): void;
  dispose(): void;
}
const rulerColors: Record<Kind, string> = {
  added: "#8fbf8a",
  modified: "#7fb0d6",
  deleted: "#c9897a",
};
const kindOf = (change: Change): Kind =>
  change.originalEnd === 0 ? "added" : change.modifiedEnd === 0 ? "deleted" : "modified";
/** Line that carries the gutter marker. Deletions sit after `modifiedStart` (0 = above line 1). */
const markerLine = (change: Change) => Math.max(1, change.modifiedStart);
const lastLine = (change: Change) =>
  kindOf(change) === "deleted" ? markerLine(change) : change.modifiedEnd;

export function attachDirtyDiff(editor: monaco.editor.IStandaloneCodeEditor): DirtyDiff {
  const modified = editor.getModel()!;
  const original = monaco.editor.createModel("", modified.getLanguageId());
  // The diff widget only computes; it is never attached to the document.
  const host = document.createElement("div");
  const diff = monaco.editor.createDiffEditor(host, {
    renderSideBySide: false,
    ignoreTrimWhitespace: false,
    maxComputationTime: 0,
  });
  diff.setModel({ original, modified });
  const collection = editor.createDecorationsCollection();
  let enabled = false;
  let changes: Change[] = [];
  let peek: { id: string; change: Change } | undefined;

  function closePeek() {
    if (!peek) return;
    const { id } = peek;
    peek = undefined;
    editor.changeViewZones((zones) => zones.removeZone(id));
  }
  function refresh() {
    closePeek();
    changes = enabled
      ? (diff.getLineChanges() ?? []).map((item) => ({
          originalStart: item.originalStartLineNumber,
          originalEnd: item.originalEndLineNumber,
          modifiedStart: item.modifiedStartLineNumber,
          modifiedEnd: item.modifiedEndLineNumber,
        }))
      : [];
    collection.set(
      changes.map((change) => {
        const kind = kindOf(change);
        const start = markerLine(change);
        const top = kind === "deleted" && change.modifiedStart === 0;
        return {
          range: new monaco.Range(start, 1, lastLine(change), 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `git-gutter-${kind}${top ? " git-gutter-deleted-top" : ""}`,
            overviewRuler: {
              color: rulerColors[kind],
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        };
      }),
    );
  }
  function revert(change: Change) {
    const kind = kindOf(change);
    const text =
      change.originalEnd > 0
        ? original.getValueInRange(
            new monaco.Range(
              change.originalStart,
              1,
              change.originalEnd,
              original.getLineMaxColumn(change.originalEnd),
            ),
          )
        : "";
    const count = modified.getLineCount();
    let range: monaco.Range;
    let value = text;
    if (kind === "deleted") {
      if (change.modifiedStart === 0) {
        range = new monaco.Range(1, 1, 1, 1);
        value = `${text}\n`;
      } else {
        const column = modified.getLineMaxColumn(change.modifiedStart);
        range = new monaco.Range(change.modifiedStart, column, change.modifiedStart, column);
        value = `\n${text}`;
      }
    } else if (kind === "modified") {
      range = new monaco.Range(
        change.modifiedStart,
        1,
        change.modifiedEnd,
        modified.getLineMaxColumn(change.modifiedEnd),
      );
    } else if (change.modifiedEnd < count) {
      range = new monaco.Range(change.modifiedStart, 1, change.modifiedEnd + 1, 1);
    } else if (change.modifiedStart > 1) {
      range = new monaco.Range(
        change.modifiedStart - 1,
        modified.getLineMaxColumn(change.modifiedStart - 1),
        change.modifiedEnd,
        modified.getLineMaxColumn(change.modifiedEnd),
      );
    } else {
      range = modified.getFullModelRange();
    }
    closePeek();
    editor.executeEdits("dirty-diff-revert", [{ range, text: kind === "added" ? "" : value }]);
    editor.pushUndoStop();
  }
  function step(from: number, direction: 1 | -1) {
    if (!changes.length) return;
    const ordered = changes.toSorted((a, b) => markerLine(a) - markerLine(b));
    const next =
      direction === 1
        ? (ordered.find((change) => markerLine(change) > from) ?? ordered[0])
        : (ordered.findLast((change) => markerLine(change) < from) ?? ordered.at(-1)!);
    editor.setPosition({ lineNumber: markerLine(next), column: 1 });
    editor.revealLineInCenterIfOutsideViewport(markerLine(next));
    openPeek(next);
  }
  function button(label: string, title: string, action: () => void) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "dirty-diff-button";
    element.textContent = label;
    element.title = title;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
    });
    return element;
  }
  function openPeek(change: Change) {
    closePeek();
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const lines =
      change.originalEnd > 0
        ? original.getLinesContent().slice(change.originalStart - 1, change.originalEnd)
        : [];
    const kind = kindOf(change);
    const node = document.createElement("div");
    node.className = `dirty-diff-peek dirty-diff-peek-${kind}`;
    const bar = document.createElement("div");
    bar.className = "dirty-diff-bar";
    bar.style.height = `${lineHeight}px`;
    const title = document.createElement("span");
    title.className = "dirty-diff-title";
    title.textContent = `Изменение ${changes.indexOf(change) + 1} из ${changes.length}`;
    const line = markerLine(change);
    bar.append(
      title,
      button("↑", "Предыдущее изменение (Shift+Alt+F3)", () => step(line, -1)),
      button("↓", "Следующее изменение (Alt+F3)", () => step(line, 1)),
      button("↶", "Откатить изменение", () => revert(change)),
      button("×", "Закрыть (Esc)", closePeek),
    );
    const body = document.createElement("div");
    body.className = "dirty-diff-body";
    body.style.lineHeight = `${lineHeight}px`;
    body.textContent = lines.join("\n");
    node.append(bar, body);
    let id = "";
    editor.changeViewZones((zones) => {
      id = zones.addZone({
        afterLineNumber: lastLine(change),
        heightInPx: lineHeight * (lines.length + 1),
        domNode: node,
        suppressMouseDown: true,
      });
    });
    peek = { id, change };
    if (lines.length)
      void monaco.editor.colorize(lines.join("\n"), modified.getLanguageId(), {}).then((html) => {
        if (peek?.id === id) body.innerHTML = html;
      });
  }

  const subscriptions = [
    diff.onDidUpdateDiff(refresh),
    editor.onMouseDown((event) => {
      const { target } = event;
      if (
        !event.event.leftButton ||
        target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
        !target.position ||
        !target.element?.className.includes("git-gutter-")
      )
        return;
      const line = target.position.lineNumber;
      const change = changes.find((item) => line >= markerLine(item) && line <= lastLine(item));
      if (!change) return;
      if (peek?.change === change) closePeek();
      else openPeek(change);
    }),
    editor.onKeyDown((event) => {
      if (event.keyCode !== monaco.KeyCode.Escape || !peek) return;
      event.preventDefault();
      event.stopPropagation();
      closePeek();
    }),
    editor.addAction({
      id: "projector.dirty-diff.next",
      label: "Следующее изменение",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F3],
      run: () => step(editor.getPosition()?.lineNumber ?? 0, 1),
    }),
    editor.addAction({
      id: "projector.dirty-diff.previous",
      label: "Предыдущее изменение",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F3],
      run: () => step(editor.getPosition()?.lineNumber ?? 0, -1),
    }),
  ];
  return {
    setOriginal(text) {
      enabled = text !== null;
      // A changed index text recomputes the diff and notifies through onDidUpdateDiff.
      if (text !== null && original.getValue() !== text) original.setValue(text);
      else refresh();
    },
    dispose() {
      closePeek();
      subscriptions.forEach((item) => item.dispose());
      collection.clear();
      diff.dispose();
      original.dispose();
    },
  };
}
