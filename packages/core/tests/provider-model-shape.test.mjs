import { expect, test } from "vite-plus/test";
import {
  providerModelKindOf,
  providerModelKindTitle,
  providerModelShape,
} from "../modules/providers/index.ts";

test("the shape says what goes in and what comes out", () => {
  expect(providerModelShape(["text"], ["text"])).toBe("текст → текст");
  expect(providerModelShape(["text"], ["image"])).toBe("текст → изображение");
  expect(providerModelShape(["audio"], ["text"])).toBe("звук → текст");
  expect(providerModelShape(["text", "image"], ["video"])).toBe("текст + изображение → видео");
  expect(providerModelShape(["text"], ["audio", "text"])).toBe("текст → звук + текст");
  expect(providerModelShape(["text"], ["vector"])).toBe("текст → вектор");
  expect(providerModelShape(undefined, undefined)).toBe("");
  expect(providerModelShape(["text"], undefined)).toBe("текст → ?");
});

test("the kind follows the modalities, with an explicit value winning", () => {
  expect(providerModelKindOf({ id: "a", input: ["text"], output: ["text"] })).toBe("chat");
  expect(providerModelKindOf({ id: "a", input: ["audio"], output: ["text"] })).toBe(
    "transcription",
  );
  expect(
    providerModelKindOf({ id: "a", input: ["text", "audio", "image"], output: ["text"] }),
  ).toBe("chat");
  expect(providerModelKindOf({ id: "a", input: ["text"], output: ["audio"] })).toBe("speech");
  expect(providerModelKindOf({ id: "a", input: ["text"], output: ["image"] })).toBe("image");
  expect(providerModelKindOf({ id: "a", input: ["text"], output: ["video"] })).toBe("video");
  expect(providerModelKindOf({ id: "a", kind: "rerank", output: ["text"] })).toBe("rerank");
});

test("kinds have Russian titles", () => {
  expect(providerModelKindTitle("chat")).toBe("чат");
  expect(providerModelKindTitle("transcription")).toBe("распознавание");
  expect(providerModelKindTitle("speech")).toBe("синтез речи");
  expect(providerModelKindTitle("image")).toBe("изображения");
  expect(providerModelKindTitle("embedding")).toBe("эмбеддинги");
});
