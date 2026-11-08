export type Output = (line?: string) => void;

export type TableValue = string | number | null | undefined;

export function writeJson(out: Output, value: unknown): void {
  out(JSON.stringify(value, null, 2) ?? "null");
}

export function printTable(
  headers: readonly string[],
  rows: ReadonlyArray<readonly TableValue[]>,
  out: Output,
): void {
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...rows.map((row) => String(row[index] ?? "").length)),
  );
  const line = (row: readonly TableValue[]) =>
    row
      .map((value, index) => String(value ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  out(line(headers));
  for (const row of rows) out(line(row));
}
