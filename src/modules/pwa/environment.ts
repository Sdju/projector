export type PwaServiceWorkerAction = "register" | "unregister" | "none";

export interface PwaEnvironment {
  production: boolean;
  secure: boolean;
  serviceWorker: boolean;
}

/**
 * A service worker left over from a prod run must not survive in dev: it would answer with a
 * cached shell while Vite serves fresh modules. Insecure origins (LAN over plain HTTP) cannot
 * register one at all, so an old registration is removed there too.
 */
export function pwaServiceWorkerAction(environment: PwaEnvironment): PwaServiceWorkerAction {
  if (!environment.serviceWorker) return "none";
  if (!environment.production || !environment.secure) return "unregister";
  return "register";
}
