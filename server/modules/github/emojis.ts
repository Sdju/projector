import { github } from "./api.ts";
import { integrationConfig } from "../integration-store/index.ts";

const TTL = 24 * 60 * 60 * 1000;
let cached: { at: number; emojis: Record<string, string> } | undefined;

/** Shortcode → image URL of every GitHub emoji (`/emojis`); the list is global, so it is cached. */
export async function githubEmojis(): Promise<Record<string, string>> {
  if (cached && Date.now() - cached.at < TTL) return cached.emojis;
  const config = await integrationConfig("github");
  const token = config.enabled ? config.credentials.token || "" : "";
  const emojis = await github<Record<string, string>>("/emojis", token);
  cached = { at: Date.now(), emojis };
  return emojis;
}
