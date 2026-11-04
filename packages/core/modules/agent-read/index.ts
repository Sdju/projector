/**
 * Some agents frame a file read as numbered lines (`1\tconst a = 1;`, `2\t…`). The chat shows the
 * file body, so the numbers are removed wherever the result is displayed or stored.
 */
const NUMBERED = /^(\d+)\t/;

export function stripReadLineNumbers(text: string): string {
  let lines = text.split("\n");
  // A trailing newline is not a numbered file line.
  if (lines.length > 1 && lines.at(-1) === "") lines = lines.slice(0, -1);
  const first = NUMBERED.exec(lines[0] ?? "");
  if (!first) return text;
  let number = Number(first[1]);
  const cleaned: string[] = [];
  for (const line of lines) {
    const prefix = `${number}\t`;
    // An unexpected shape means this is not a numbered file body: keep it untouched.
    if (!line.startsWith(prefix)) return text;
    cleaned.push(line.slice(prefix.length));
    number++;
  }
  return cleaned.join("\n");
}
