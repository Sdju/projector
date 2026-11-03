/** Let the browser/IME translate physical US keys before xterm sends text. */
export function deferTerminalText(event: KeyboardEvent): boolean {
  return (
    event.type === "keydown" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    event.key.length === 1 &&
    event.key >= " " &&
    event.key <= "~"
  );
}
