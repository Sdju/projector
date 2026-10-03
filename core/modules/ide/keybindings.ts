import type { Keybinding } from "./commands.ts";
const tree = { surface: "fileTree" };
export const defaultKeybindings: Keybinding[] = [
  { key: "Mod+Shift+P", command: "ide.workbench.commandPalette.open", allowInput: true },
  { key: "F1", command: "ide.workbench.commandPalette.open", allowInput: true },
  { key: "F2", command: "ide.fileTree.file.rename", when: { ...tree, entryKind: "file" } },
  {
    key: "F2",
    command: "ide.fileTree.directory.rename",
    when: { ...tree, entryKind: "directory" },
  },
  { key: "Delete", command: "ide.fileTree.entry.delete", when: tree },
  { key: "Mod+C", command: "ide.fileTree.entry.copy", when: tree },
  { key: "Mod+X", command: "ide.fileTree.entry.cut", when: tree },
  { key: "Mod+V", command: "ide.fileTree.entry.paste", when: tree },
  { key: "Enter", command: "ide.fileTree.file.open", when: { ...tree, entryKind: "file" } },
  {
    key: "Enter",
    command: "ide.fileTree.directory.toggle",
    when: { ...tree, entryKind: "directory" },
  },
  { key: "Shift+F10", command: "ide.fileTree.contextMenu", when: tree },
  { key: "ContextMenu", command: "ide.fileTree.contextMenu", when: tree },
  { key: "ArrowRight", command: "ide.workbench.tabs.next" },
  { key: "ArrowLeft", command: "ide.workbench.tabs.previous" },
  { key: "Home", command: "ide.workbench.tabs.first" },
  { key: "End", command: "ide.workbench.tabs.last" },
  { key: "Shift+F10", command: "ide.workbench.tabs.contextMenu" },
  { key: "ContextMenu", command: "ide.workbench.tabs.contextMenu" },
  { key: "F2", command: "ide.workbench.tabs.rename" },
  { key: "Mod+S", command: "ide.editor.file.save", when: { surface: "editor" }, allowInput: true },
  {
    key: "Mod+Shift+M",
    command: "ide.editor.markdown.toggleSource",
    when: { surface: "editor" },
    allowInput: true,
  },
];
