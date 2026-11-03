/** Project-relative paths use forward slashes, including on the wire. */
export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function moveDestination(path: string, directory: string): string | undefined {
  if (!path || directory === path || directory.startsWith(`${path}/`)) return;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const destination = directory ? `${directory}/${name}` : name;
  return destination === path ? undefined : destination;
}

export function relocatedPath(path: string, source: string, destination: string): string {
  return path === source || path.startsWith(`${source}/`)
    ? destination + path.slice(source.length)
    : path;
}
