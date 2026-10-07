// Общая подготовка каждого тестового файла: изолированные данные и реальные таймеры между тестами.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vite-plus/test";

process.env.XDG_DATA_HOME ??= mkdtempSync(join(tmpdir(), "projector-test-data-"));
afterEach(() => vi.useRealTimers());
