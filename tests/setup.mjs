// Общая подготовка каждого тестового файла: изолированные данные и реальные таймеры между тестами.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vite-plus/test";

// Windows runners hand out 8.3 names (RUNNER~1); the server resolves real paths, so tests must too.
if (process.platform === "win32")
  process.env.TEMP = process.env.TMP = realpathSync.native(tmpdir());
// macOS keeps temp under /var, a symlink to /private/var; the server resolves it too.
if (process.platform === "darwin") process.env.TMPDIR = realpathSync.native(tmpdir());
process.env.XDG_DATA_HOME ??= mkdtempSync(join(tmpdir(), "projector-test-data-"));
afterEach(() => vi.useRealTimers());
