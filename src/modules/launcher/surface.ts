// Keep the app-window identity when navigating to projects or settings.
if (new URLSearchParams(location.search).get("surface") === "window") {
  sessionStorage.setItem("projector-surface", "window");
}
export const isLauncherWindow = sessionStorage.getItem("projector-surface") === "window";
