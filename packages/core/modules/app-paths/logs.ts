import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { dataDir } from "./paths.ts";

/** Диагностический лог запуска: `stdout` и `stderr` сервера дописываются сюда. */
export const SERVER_LOG = "server.log";

/** Размер активного файла, после которого он уступает место новому. */
export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;

/** Сколько архивов `server.log.1…N` хранится рядом с активным файлом. */
export const DEFAULT_LOG_MAX_FILES = 5;

/** Как часто работающий сервер проверяет размер собственного лога. */
export const DEFAULT_LOG_CHECK_MS = 15_000;

export interface LogRotationOptions {
  /** Порог активного файла в байтах. */
  maxBytes?: number;
  /** Число архивов, не считая активного файла. */
  maxFiles?: number;
  /** Интервал проверки для запущенного сервера. */
  intervalMs?: number;
  /** Ротировать существующий файл перед открытием. */
  rotate?: boolean;
}

export interface LogRotationSettings {
  maxBytes: number;
  maxFiles: number;
  intervalMs: number;
}

type RotationHost = typeof globalThis & {
  projectorLogRotation?: Map<string, () => void>;
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function logRotationSettings(options: LogRotationOptions = {}): LogRotationSettings {
  return {
    maxBytes: Math.max(
      1024,
      Math.floor(options.maxBytes ?? envNumber("PROJECTOR_LOG_MAX_BYTES", DEFAULT_LOG_MAX_BYTES)),
    ),
    maxFiles: Math.max(
      1,
      Math.floor(options.maxFiles ?? envNumber("PROJECTOR_LOG_MAX_FILES", DEFAULT_LOG_MAX_FILES)),
    ),
    intervalMs: Math.max(
      100,
      Math.floor(options.intervalMs ?? envNumber("PROJECTOR_LOG_CHECK_MS", DEFAULT_LOG_CHECK_MS)),
    ),
  };
}

export function serverLogPath(): string {
  return join(dataDir(), SERVER_LOG);
}

function fileSize(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/**
 * Сдвигает `file` → `file.1`, `file.1` → `file.2` и удаляет самый старый архив.
 * Возвращает `false`, если активный файл ещё не дорос до порога.
 */
export function rotateLog(file: string, options: LogRotationOptions = {}): boolean {
  const { maxBytes, maxFiles } = logRotationSettings(options);
  const size = fileSize(file);
  if (size === undefined || size < maxBytes) return false;
  mkdirSync(dirname(file), { recursive: true });
  rmSync(`${file}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${file}.${index}`;
    if (existsSync(source)) renameSync(source, `${file}.${index + 1}`);
  }
  rmSync(`${file}.1`, { force: true });
  renameSync(file, `${file}.1`);
  return true;
}

/** Ротирует файл (если нужно) и открывает его на дозапись. */
export function openLog(file: string, options: LogRotationOptions = {}): number {
  const { rotate = true } = options;
  mkdirSync(dirname(file), { recursive: true });
  if (rotate) rotateLog(file, options);
  return openSync(file, "a");
}

function closeStandardStreams(): void {
  for (const fd of [1, 2]) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
}

function reopenStandardStreams(file: string): void {
  const out = openSync(file, "a");
  const err = openSync(file, "a");
  if (out !== 1 || err !== 2) {
    throw new Error(`не удалось вернуть stdout/stderr на server.log (fd ${out}, ${err})`);
  }
}

/**
 * Ротирует открытый файл без закрытия стандартных потоков: копирует его в
 * архив и обнуляет активный. Так `console.log` продолжает писать в тот же
 * дескриптор, что и на Windows, где переименовать открытый файл нельзя.
 */
function rotateOpenLog(file: string, settings: LogRotationSettings): boolean {
  const size = fileSize(file);
  if (size === undefined || size < settings.maxBytes) return false;
  mkdirSync(dirname(file), { recursive: true });
  rmSync(`${file}.${settings.maxFiles}`, { force: true });
  for (let index = settings.maxFiles - 1; index >= 1; index -= 1) {
    const source = `${file}.${index}`;
    if (existsSync(source)) renameSync(source, `${file}.${index + 1}`);
  }
  rmSync(`${file}.1`, { force: true });
  copyFileSync(file, `${file}.1`);
  truncateSync(file, 0);
  return true;
}

/**
 * Ротирует файл, в который перенаправлены `stdout` и `stderr` самого процесса.
 * На POSIX файл можно переименовать открытым, а затем вернуть дескрипторы;
 * на Windows открытый файл остаётся на месте, а его содержимое уходит в архив.
 */
export function rotateStandardStreams(file: string, options: LogRotationOptions = {}): boolean {
  const settings = logRotationSettings(options);
  const size = fileSize(file);
  if (size === undefined || size < settings.maxBytes) return false;
  let rotated = false;
  if (process.platform === "win32") {
    try {
      rotated = rotateOpenLog(file, settings);
    } catch {
      rotated = false;
    }
  } else {
    // Close first: POSIX reopens the same descriptor numbers after the rename.
    closeStandardStreams();
    try {
      rotated = rotateLog(file, settings);
    } catch {
      rotated = false;
    }
    reopenStandardStreams(file);
  }
  if (rotated) {
    try {
      writeSync(
        1,
        `[projector] rotated ${basename(file)}: ${size} bytes -> ${basename(file)}.1 at ${new Date().toISOString()}\n`,
      );
    } catch {
      /* the new stream is still usable */
    }
  }
  return rotated;
}

/**
 * Проверяет размер `PROJECTOR_SERVER_LOG` и ротирует его на ходу.
 * Без переменной (сервер запущен вручную в терминале) ничего не делает.
 */
export function startServerLogRotation(): () => void {
  const file = process.env.PROJECTOR_SERVER_LOG;
  if (!file) return () => undefined;
  // The marker is for this process only: terminals and agents must not inherit it.
  delete process.env.PROJECTOR_SERVER_LOG;
  return startLogRotation(file);
}

/**
 * Фоновый watcher для файла, в который пишет сам процесс. Повторный вызов
 * для того же файла возвращает существующую остановку: Vite перезагружает модули.
 */
export function startLogRotation(file: string, options: LogRotationOptions = {}): () => void {
  const host = globalThis as RotationHost;
  const active = (host.projectorLogRotation ??= new Map());
  const existing = active.get(file);
  if (existing) return existing;
  const settings = logRotationSettings(options);
  let stopped = false;
  let reported = false;
  const check = () => {
    if (stopped) return;
    try {
      rotateStandardStreams(file, settings);
      reported = false;
    } catch (error) {
      if (reported) return;
      reported = true;
      try {
        writeSync(
          2,
          `[projector] log rotation failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      } catch {
        /* stderr is the file being rotated */
      }
    }
  };
  const timer = setInterval(check, settings.intervalMs);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    active.delete(file);
  };
  active.set(file, stop);
  check();
  return stop;
}
