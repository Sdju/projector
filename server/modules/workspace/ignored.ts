import { spawn } from "node:child_process";

// Paths (relative to `dir`) that git ignores; empty when git or the repository is missing.
export function ignoredPaths(dir: string, names: string[]): Promise<Set<string>> {
  if (!names.length) return Promise.resolve(new Set());
  return new Promise((done) => {
    const child = spawn("git", ["-C", dir, "check-ignore", "-z", "--stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    let out = "";
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => done(new Set()));
    child.on("close", () => {
      clearTimeout(timer);
      done(new Set(out.split("\0").filter(Boolean)));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(names.join("\0") + "\0");
  });
}
