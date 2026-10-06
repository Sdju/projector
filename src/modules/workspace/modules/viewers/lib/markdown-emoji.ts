import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { splitEmoji, type EmojiMap } from "../../../../../common/utilities/github-emoji.ts";

const SHORTCODE = /:([a-z0-9_+-]+):/gi;

/**
 * Readonly Markdown: `:tada:` is drawn as GitHub's emoji image. The document is not changed,
 * the shortcode text is only hidden under a widget, so nothing is lost on copy or save.
 */
export const githubEmojiDecorations = (map: EmojiMap) =>
  $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position, parent) => {
              if (!node.isText || !node.text || parent?.type.spec.code) return;
              if (node.marks.some((mark) => mark.type.name === "inlineCode")) return;
              const text = node.text;
              for (const match of text.matchAll(SHORTCODE)) {
                const part = splitEmoji(match[0], map)[0];
                if (typeof part === "string") continue;
                const from = position + match.index;
                decorations.push(
                  Decoration.widget(
                    from,
                    () => {
                      const image = document.createElement("img");
                      image.className = "github-emoji";
                      image.src = part.url;
                      image.alt = match[0];
                      image.title = match[0];
                      image.loading = "lazy";
                      return image;
                    },
                    { side: -1 },
                  ),
                  Decoration.inline(from, from + match[0].length, { style: "display: none" }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
  );
