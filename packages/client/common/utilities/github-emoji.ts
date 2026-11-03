import { shallowRef } from "vue";

export type EmojiMap = Record<string, string>;
export type EmojiPart = string | { name: string; url: string };

/** GitHub names its reactions differently from its emoji: `laugh` is :smile:, `hooray` is :tada:. */
export const REACTION_EMOJI: Record<string, string> = {
  "+1": "+1",
  "-1": "-1",
  laugh: "smile",
  hooray: "tada",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes",
};
export const REACTION_LABEL: Record<string, string> = {
  "+1": "Нравится",
  "-1": "Не нравится",
  laugh: "Смех",
  hooray: "Ура",
  confused: "Недоумение",
  heart: "Сердце",
  rocket: "Ракета",
  eyes: "Глаза",
};

const emojis = shallowRef<EmojiMap>({});
let loading: Promise<EmojiMap> | undefined;

/** Shortcode → image URL from `/emojis` of GitHub, read once per page; a failure can be retried. */
export function loadGithubEmojis(): Promise<EmojiMap> {
  loading ??= fetch("/api/integrations/github/emojis")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("emojis"))))
    .then((map: EmojiMap) => (emojis.value = map))
    .catch(() => {
      loading = undefined;
      return emojis.value;
    });
  return loading;
}
/** Reactive map: empty until the list arrives, so text shows shortcodes in the meantime. */
export function useGithubEmojis() {
  void loadGithubEmojis();
  return emojis;
}

const SHORTCODE = /:([a-z0-9_+-]+):/gi;
/** Text split into plain pieces and known emoji; unknown shortcodes stay as written. */
export function splitEmoji(text: string, map: EmojiMap): EmojiPart[] {
  const parts: EmojiPart[] = [];
  let last = 0;
  for (const match of text.matchAll(SHORTCODE)) {
    const name = match[1].toLowerCase();
    const url = Object.hasOwn(map, name) ? map[name] : undefined;
    if (!url) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ name, url });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
