/** Coordinates all Projector pages on this origin without persistent browser state. */
export function createPageReload(reportError: (error: unknown) => void, changed: () => void) {
  const channel = new BroadcastChannel("projector:page-reload");
  let busy = false;
  let disposed = false;
  const setBusy = (value: boolean) => {
    busy = value;
    changed();
  };

  async function health() {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || data.app !== "projector" || !Number.isInteger(data.pid))
      throw new Error("Сервер Projector недоступен");
    return data.pid as number;
  }

  async function reloadAfterRestart(pid: number) {
    setBusy(true);
    try {
      const deadline = Date.now() + 60_000;
      while (!disposed && Date.now() < deadline) {
        try {
          if ((await health()) !== pid) {
            if (!disposed) window.location.reload();
            return;
          }
        } catch {
          /* The old server is shutting down or the successor is starting. */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!disposed)
        throw new Error("Сервер не запустился за 60 секунд. Страницы не перезагружены.");
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  channel.onmessage = ({ data }) => {
    if (disposed || busy) return;
    if (data?.type === "reload") window.location.reload();
    if (data?.type === "restart" && Number.isInteger(data.pid))
      void reloadAfterRestart(data.pid).catch(reportError);
  };

  return {
    isBusy: () => busy,
    reloadPages() {
      channel.postMessage({ type: "reload" });
      window.location.reload();
    },
    async restartServer() {
      if (
        busy ||
        !window.confirm(
          "Перезапустить сервер Projector и открытые страницы? Все терминалы и дочерние процессы будут завершены. Сохраните изменения перед перезапуском.",
        )
      )
        return;
      setBusy(true);
      try {
        const pid = await health();
        const response = await fetch("/api/app/restart", { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new Error(data.error || "Не удалось перезапустить сервер Projector");
        channel.postMessage({ type: "restart", pid });
        await reloadAfterRestart(pid);
      } finally {
        if (!disposed) setBusy(false);
      }
    },
    dispose() {
      disposed = true;
      channel.close();
    },
  };
}
