// "Only the owner can read this": 0600 on POSIX, a single ACL entry on Windows.
import { stat } from "node:fs/promises";
import { expect } from "vite-plus/test";
import { aclPrincipals } from "./acl.mjs";

export async function expectPrivate(path) {
  if (process.platform === "win32") {
    const principals = await aclPrincipals(path);
    expect(principals, `${path}: ${JSON.stringify(principals)}`).toHaveLength(1);
    expect(principals[0].toLowerCase()).toContain(process.env.USERNAME.toLowerCase());
  } else expect((await stat(path)).mode & 0o777).toBe(0o600);
}
