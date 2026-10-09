import { homedir } from "node:os";
import { join } from "node:path";

export function xdgDataHome() {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
}
export function configHome() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}
