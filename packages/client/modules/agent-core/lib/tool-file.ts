/** Picture formats the chat can show; a file name may carry a query or a fragment. */
const IMAGE = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

/** Whether a tool call reads a picture rather than text. */
export function isImageFile(path: string): boolean {
  const name = path.split(/[?#]/)[0] ?? "";
  return IMAGE.test(name);
}

/** The skill a `SKILL.md` belongs to, by its folder; empty for every other file. */
export function skillName(path: string): string {
  const parts = path.split(/[\\/]/);
  if ((parts.at(-1) ?? "").toLowerCase() !== "skill.md") return "";
  return parts.at(-2) ?? "";
}
