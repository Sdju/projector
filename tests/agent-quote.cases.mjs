import { expect, test } from "vite-plus/test";
import { blockquote } from "../packages/client/modules/agent/modules/composer/lib/chat-quote.ts";

test("a chat selection becomes a Markdown quote line by line", () => {
  expect(blockquote("  Первая строка\nвторая\n\nчетвёртая  ")).toBe(
    ">   Первая строка\n> вторая\n>\n> четвёртая",
  );
});

test("a quote drops empty lines at its edges and normalizes line endings", () => {
  expect(blockquote("\n\nПривет\r\n\r\nмир\n\n")).toBe("> Привет\n>\n> мир");
});

test("a selection without text makes no quote", () => {
  expect(blockquote("")).toBe("");
  expect(blockquote("  \n\t\n")).toBe("");
});
