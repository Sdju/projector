export function shortPath(path: string): string {
  const home = "/home/";
  if (path.startsWith(home)) {
    const rest = path.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) return `~/${rest.slice(slash + 1)}`;
  }
  return path;
}

export function statusLabel(status: string): string {
  if (status === "running") return "работает";
  if (status === "starting") return "старт";
  if (status === "stopping") return "стоп";
  if (status === "error") return "ошибка";
  return "стоп";
}
