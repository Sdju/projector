import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Прочитанный один раз ответ: `undefined` означает, что версии в манифестах не нашлось. */
let resolved: { version?: string } | undefined;

/**
 * Версия установленного Projector для проверки `engines.projector` у плагинов. Отдельной копии
 * номера в коде нет: берётся ближайший манифест выше этого модуля. В дереве исходников это
 * `packages/server/package.json`, в собранной поставке — манифест `@ai-projector/ide`, потому что
 * манифесты пакетов при упаковке не копируются. Если версию прочитать нельзя, проверка идёт без
 * ограничения, но об этом сообщается в лог: молчаливое «нет ограничения» скрыло бы сломанную
 * поставку.
 */
export function installedProjectorVersion(): string | undefined {
  resolved ??= { version: readProjectorVersion(dirname(fileURLToPath(import.meta.url))) };
  return resolved.version;
}

/** Ищет `version` в ближайшем манифесте вверх от `start`; причину отказа пишет в лог. */
export function readProjectorVersion(start: string): string | undefined {
  let directory = start;
  for (;;) {
    const file = join(directory, "package.json");
    let text: string | undefined;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warn(`файл ${file} не читается: ${reason(error)}`);
        return;
      }
    }
    if (text !== undefined) {
      try {
        const manifest: unknown = JSON.parse(text);
        const version =
          manifest && typeof manifest === "object"
            ? (manifest as { version?: unknown }).version
            : undefined;
        if (typeof version === "string" && version) return version;
      } catch (error) {
        warn(`файл ${file} повреждён: ${reason(error)}`);
        return;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      warn("рядом с модулем плагинов нет package.json с полем version");
      return;
    }
    directory = parent;
  }
}

function warn(problem: string): void {
  console.warn(
    `Версия Projector не определена: ${problem}. Проверка engines.projector у плагинов пропущена`,
  );
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
