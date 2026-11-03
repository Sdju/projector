import { Crepe } from "@milkdown/crepe";
import { $remark } from "@milkdown/kit/utils";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

function embedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
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
