import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { $remark } from "@milkdown/kit/utils";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { createMermaidBlock } from "../../../../markdown/index.ts";

/** A filled comment bubble, like the built-in toolbar icons. */
const chatIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-3 9h-4v4h-2v-4H7V9h4V5h2v4h4v2Z" />
  </svg>
`;

function embedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Не удалось прочитать изображение"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.readAsDataURL(file);
  });
}

/** Crepe with Projector's labels and features; the caller owns image URL resolution. */
export function createCrepe(options: {
  root: HTMLElement;
  content: string;
  editable: boolean;
  imageUrl: (url: string) => string;
  /** Adds the selected Markdown text to the agent chat from the native toolbar. */
  selectionToChat?: (text: string) => void;
}) {
  return new Crepe({
    root: options.root,
    defaultValue: options.content,
    features: {
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.Toolbar]: options.editable,
      [Crepe.Feature.BlockEdit]: options.editable,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Начните писать…" },
      [Crepe.Feature.Toolbar]: {
        boldLabel: "Жирный",
        italicLabel: "Курсив",
        strikethroughLabel: "Зачёркнутый",
        codeLabel: "Код",
        linkLabel: "Ссылка",
        buildToolbar: (builder) => {
          builder.addGroup("projector", "Projector").addItem("to-chat", {
            icon: chatIcon,
            label: "В чат",
            active: () => false,
            onRun: (ctx) => {
              const view = ctx.get(editorViewCtx);
              const { from, to } = view.state.selection;
              options.selectionToChat?.(view.state.doc.textBetween(from, to, "\n", "\n"));
            },
          });
        },
      },
      [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "Адрес ссылки" },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: options.imageUrl,
        onUpload: embedImage,
        inlineUploadPlaceholderText: "или вставьте ссылку",
        blockUploadPlaceholderText: "или вставьте ссылку",
        blockCaptionPlaceholderText: "Подпись изображения",
        blockConfirmButton: "Вставить",
      },
      [Crepe.Feature.CodeMirror]: {
        languages,
        theme: oneDark,
        searchPlaceholder: "Язык кода",
        copyText: "Копировать",
        noResultText: "Не найдено",
        renderPreview: (language, content) =>
          language.trim().toLowerCase() === "mermaid"
            ? createMermaidBlock(content, { expand: () => {}, source: () => {} }).element
            : null,
      },
    },
  });
}

// Remark uses null for an omitted image title, while Milkdown 7.22's
// image schemas require strings. Normalize it before schema validation.
export const normalizeImageAttributes = $remark("projectorImageAttributes", () => () => (tree) => {
  function normalize(node: {
    type: string;
    title?: unknown;
    alt?: unknown;
    children?: Parameters<typeof normalize>[0][];
  }) {
    if (node.type === "image" || node.type === "image-block") {
      node.title ??= "";
      node.alt ??= "";
    }
    node.children?.forEach(normalize);
  }
  normalize(tree);
});
