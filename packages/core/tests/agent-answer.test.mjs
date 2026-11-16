import { expect, test } from "vite-plus/test";
import { answerPreview } from "../modules/agent-answer/index.ts";

test("widget markup and scripts never reach a notification body", () => {
  const answer = `<Card title="Причина" hint="один WebSocket-кадр не может быть больше 256 КиБ">
<Bars unit=" КБ" :items="[{label:'828a', value:300}]" />
</Card>

Кадр больше лимита, поэтому туннель рвёт соединение.

<script>const n = ref(1); return { n };</script>`;

  expect(answerPreview(answer)).toBe("Кадр больше лимита, поэтому туннель рвёт соединение.");
});

test("an answer made only of widgets leaves no preview", () => {
  expect(answerPreview('<Card title="Итоги"><Stat label="Тесты" value="12" /></Card>')).toBe("");
});

test("markdown is flattened and code blocks are not part of the summary", () => {
  const answer = `## Итог

**Готово:** все тесты прошли.

- \`vp test\` зелёный
- сборка собрана

\`\`\`bash
vp run check
\`\`\`

[Подробнее](https://example.com)`;

  expect(answerPreview(answer)).toBe(
    "Итог Готово: все тесты прошли. vp test зелёный сборка собрана Подробнее",
  );
});

test("a plain answer survives and a long one is cut", () => {
  expect(answerPreview("Все 12 тестов прошли")).toBe("Все 12 тестов прошли");
  expect(answerPreview("а".repeat(400), 300)).toHaveLength(300);
});
