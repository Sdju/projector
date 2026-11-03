/**
 * OpenCode frames a file read as `Read file <path>, lines <from>-<to>` followed by numbered
 * lines. The chat shows a tool result as text, so the frame and the numbers are removed here:
 * the shared client renders the file body without knowing how OpenCode labels it.
 */
const HEADER = /^Read file (.+), lines (\d+)-(\d+)\r?\n/;
const EMPTY = /^Read file .+, 0 lines\r?\n?$/;
const TRUNCATED = /^\[Output truncated\. Continue reading with offset: \d+\]$/;

export function cleanReadOutput(text: string): string {
  if (EMPTY.test(text)) return "";
  const header = HEADER.exec(text);
  if (!header) return text;
  const from = Number(header[2]);
  const lines = text.slice(header[0].length).split(/\r?\n/);
  // A file that merely begins with this phrase is not a read result: keep it untouched.
  const first = lines[0] ?? "";
  if (first !== `${from}:` && !first.startsWith(`${from}: `)) return text;
  const cleaned: string[] = [];
  let number = from;
  for (const [index, line] of lines.entries()) {
    // A trailing newline is not a numbered file line.
    if (index === lines.length - 1 && line === "") break;
    if (TRUNCATED.test(line)) {
      cleaned.push(line);
      continue;
    }
    const prefix = `${number}: `;
    if (line.startsWith(prefix)) {
      cleaned.push(line.slice(prefix.length));
      number++;
      continue;
    }
    if (line === `${number}:`) {
      cleaned.push("");
      number++;
      continue;
    }
    // An unexpected shape keeps the body, but still without the duplicated header.
    return lines.join("\n");
  }
  return cleaned.join("\n");
}
