/** Removes the named variables from `env` in place and returns the names that were present. */
export function clearSessionEnv(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const removed: string[] = [];
  for (const name of names) {
    if (env[name] === undefined) continue;
    delete env[name];
    removed.push(name);
  }
  return removed;
}
