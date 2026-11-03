import { computed, ref, shallowRef } from "vue";
import { pwaServiceWorkerAction } from "./environment.ts";

export interface PwaInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

const installPrompt = shallowRef<PwaInstallPromptEvent | null>(null);
const installed = ref(false);
const standalone = ref(false);
const fullscreen = ref(false);
const worker = ref<"unknown" | "active" | "none">("unknown");
const mode = ref<"dev" | "prod" | "unknown">("unknown");
const error = ref("");
let started = false;

/** Installability and display state shared by the settings section, commands and mobile UI. */
export function usePwa() {
  return {
    installed,
    standalone,
    fullscreen,
    worker,
    mode,
    error,
    canInstall: computed(
      () => installPrompt.value !== null && !installed.value && !standalone.value,
    ),
  };
}

export function initPwa(): void {
  if (started) return;
  started = true;
  standalone.value = runningStandalone();
  document.addEventListener("fullscreenchange", syncFullscreen);
  for (const query of ["(display-mode: standalone)", "(display-mode: fullscreen)"]) {
    window.matchMedia(query).addEventListener("change", () => {
      standalone.value = runningStandalone();
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    // Chrome shows its own mini-infobar unless the event is cancelled; the settings screen and
    // the IDE command own the prompt instead.
    event.preventDefault();
    installPrompt.value = event as PwaInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installed.value = true;
    installPrompt.value = null;
    error.value = "";
  });
  void configureWorker();
}

/**
 * Server mode is the only trustworthy signal: a build may run under NODE_ENV=development
 * (then Vite reports PROD=false), while `vp preview` serves a production bundle. The health
 * endpoint names the mode the running server actually uses.
 */
async function configureWorker() {
  const production = await readProduction();
  if (production === null) {
    worker.value = "unknown";
    return;
  }
  mode.value = production ? "prod" : "dev";
  const action = pwaServiceWorkerAction({
    production,
    secure: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
  });
  if (action === "register") await registerShell();
  else if (action === "unregister") await releaseShell();
  else worker.value = "none";
}

async function readProduction(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { mode?: unknown };
    if (data.mode === "prod") return true;
    if (data.mode === "dev") return false;
    return null;
  } catch {
    return null;
  }
}

export async function installApp(): Promise<"accepted" | "dismissed" | "installed"> {
  if (installed.value || standalone.value) return "installed";
  const prompt = installPrompt.value;
  if (!prompt)
    throw new Error(
      "Браузер пока не предлагает установку. Используйте меню браузера → «Установить приложение», а на iPhone — «Поделиться» → «На экран Домой».",
    );
  await prompt.prompt();
  const choice = await prompt.userChoice;
  installPrompt.value = null;
  if (choice.outcome !== "accepted") return "dismissed";
  installed.value = true;
  return "accepted";
}

export function fullscreenAvailable(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

/** Fullscreen API is the only way to hide browser chrome without installing the app. */
export async function toggleFullscreen(): Promise<boolean> {
  if (!fullscreenAvailable())
    throw new Error(
      "Браузер не поддерживает полноэкранный режим. На iPhone установите Projector на экран «Домой».",
    );
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    syncFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  syncFullscreen();
  return true;
}

export function runningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    ios ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function isSecurePwaOrigin(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

function syncFullscreen() {
  fullscreen.value = document.fullscreenElement !== null;
}

async function registerShell() {
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    worker.value = "active";
    error.value = "";
  } catch (value) {
    worker.value = "none";
    error.value = value instanceof Error ? value.message : "Не удалось включить service worker";
  }
}

async function releaseShell() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(ours).map((registration) => registration.unregister()));
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("projector-shell-")).map((key) => caches.delete(key)),
    );
    worker.value = "none";
    error.value = "";
  } catch (value) {
    worker.value = "none";
    error.value = value instanceof Error ? value.message : "Не удалось очистить service worker";
  }
}

function ours(registration: ServiceWorkerRegistration): boolean {
  return [registration.active, registration.installing, registration.waiting].some((entry) =>
    entry?.scriptURL.endsWith("/sw.js"),
  );
}
