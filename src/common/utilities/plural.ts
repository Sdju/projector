/** Russian plural form for a count: `1 коммит`, `2 коммита`, `5 коммитов`. */
export function pluralRu(count: number, one: string, few: string, many: string) {
  const value = Math.abs(Math.trunc(count));
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** `2 коммита`, `31 файл`: a number with the matching noun form. */
export function countRu(count: number, one: string, few: string, many: string) {
  return `${count} ${pluralRu(count, one, few, many)}`;
}
