import type { MessagePart } from "../../agent/index.ts";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The prompt as ACP blocks: the text, which already names every file as `@path`, plus a link to
 * each file or folder so an agent can open it without guessing what the name refers to.
 */
export function promptBlocks(
  text: string,
  parts: MessagePart[] | undefined,
  cwd: string | undefined,
  images: { mime: string; data: string }[],
) {
  const links = (parts ?? []).flatMap((part) => {
    if (part.type !== "file") return [];
    const name = basename(part.path.replace(/\\/g, "/"));
    return [
      {
        type: "resource_link",
        name: part.range ? `${name}:${part.range.from}-${part.range.to}` : name,
        uri: pathToFileURL(resolve(cwd ?? "/", part.path)).href,
      },
    ];
  });
  return [
    { type: "text", text },
    ...links,
    ...images.map((image) => ({ type: "image", mimeType: image.mime, data: image.data })),
  ];
}
