import { z } from "zod";

const names = z.array(z.string().min(1).max(256)).min(1);
const iconId = z.string().min(1);
const hex = /^#[\da-f]{6}$/i;
const ruleSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["file", "directory"]),
    names: names.optional(),
    extensions: names.optional(),
    patterns: names.optional(),
    paths: names.optional(),
    caseSensitive: z.boolean().optional(),
    executable: z.boolean().optional(),
    icon: iconId,
    expandedIcon: iconId.optional(),
  })
  .refine(
    (rule) =>
      Boolean(
        rule.names ||
        rule.extensions ||
        rule.patterns ||
        rule.paths ||
        rule.executable !== undefined,
      ),
    {
      message: "A rule needs names, extensions, patterns, paths or executable",
    },
  );

export const fileIconThemeSchema = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(1),
    name: z.string().min(1),
    palette: z.record(z.string(), z.string().regex(hex)),
    icons: z.record(
      z.string(),
      z.strictObject({
        // Same-origin assets only; no executable markup or remote requests from configuration.
        src: z
          .string()
          .regex(/^\/file-icons\/(?:[\w-]+\/)*[\w.-]+\.svg$/)
          .refine((src) => !src.includes("..")),
        color: z.string().min(1),
      }),
    ),
    defaults: z.strictObject({ file: iconId, directory: iconId, expandedDirectory: iconId }),
    rules: z.array(ruleSchema),
  })
  .superRefine((theme, context) => {
    const checkIcon = (id: string, path: (string | number)[]) => {
      if (!Object.hasOwn(theme.icons, id))
        context.addIssue({ code: "custom", path, message: `Unknown icon: ${id}` });
    };
    for (const [key, id] of Object.entries(theme.defaults)) checkIcon(id, ["defaults", key]);
    for (const [id, icon] of Object.entries(theme.icons)) {
      if (!hex.test(icon.color) && !Object.hasOwn(theme.palette, icon.color))
        context.addIssue({
          code: "custom",
          path: ["icons", id, "color"],
          message: `Unknown color: ${icon.color}`,
        });
    }
    const ids = new Set<string>();
    theme.rules.forEach((rule, index) => {
      if (ids.has(rule.id))
        context.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: `Duplicate rule: ${rule.id}`,
        });
      ids.add(rule.id);
      checkIcon(rule.icon, ["rules", index, "icon"]);
      if (rule.expandedIcon) checkIcon(rule.expandedIcon, ["rules", index, "expandedIcon"]);
      if (rule.kind === "directory" && rule.extensions)
        context.addIssue({
          code: "custom",
          path: ["rules", index, "extensions"],
          message: "Extensions only apply to files",
        });
      if (rule.kind === "directory" && rule.executable !== undefined)
        context.addIssue({
          code: "custom",
          path: ["rules", index, "executable"],
          message: "Executable only applies to files",
        });
    });
  });

export type FileIconTheme = z.infer<typeof fileIconThemeSchema>;
export interface IconEntry {
  name: string;
  path: string;
  directory: boolean;
  executable?: boolean;
}
export interface ResolvedFileIcon {
  id: string;
  src: string;
  color: string;
  ruleId?: string;
  badge?: { id: string; src: string; color: string };
}

// * and ? stay inside a path segment; ** crosses folders; **/ also matches zero folders.
function glob(pattern: string, sensitive: boolean) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        source += "(?:.*/)?";
        i++;
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, sensitive ? "" : "i");
}

/** Framework-independent, immutable snapshot. Ordered rules: the first match wins. */
export function createFileIconResolver(input: unknown) {
  const theme = fileIconThemeSchema.parse(input);
  const rules = theme.rules.map((rule) => {
    const normalize = (value: string) => (rule.caseSensitive ? value : value.toLowerCase());
    const names = new Set(rule.names?.map(normalize));
    const extensions = rule.extensions?.map((value) => normalize(value.replace(/^\./, "")));
    const patterns = rule.patterns?.map((value) => glob(value, !!rule.caseSensitive));
    const paths = rule.paths?.map((value) => glob(value, !!rule.caseSensitive));
    return {
      rule,
      matches(entry: IconEntry) {
        if (entry.directory !== (rule.kind === "directory")) return false;
        if (rule.executable !== undefined && rule.executable !== !!entry.executable) return false;
        const name = normalize(entry.name);
        const path = entry.path.replaceAll("\\", "/").replace(/^\.\//, "");
        return (
          (rule.executable !== undefined &&
            !rule.names &&
            !rule.extensions &&
            !rule.patterns &&
            !rule.paths) ||
          names.has(name) ||
          extensions?.some((ext) => name.length > ext.length + 1 && name.endsWith(`.${ext}`)) ||
          patterns?.some((pattern) => pattern.test(entry.name)) ||
          paths?.some((pattern) => pattern.test(path))
        );
      },
    };
  });
  return {
    name: theme.name,
    resolve(this: void, entry: IconEntry, expanded = false): ResolvedFileIcon {
      const rule = rules.find((rule) => rule.matches(entry))?.rule;
      if (entry.directory) {
        const id = expanded ? theme.defaults.expandedDirectory : theme.defaults.directory;
        const badgeId = expanded ? (rule?.expandedIcon ?? rule?.icon) : rule?.icon;
        const badge =
          badgeId &&
          badgeId !== id &&
          badgeId !== theme.defaults.directory &&
          badgeId !== theme.defaults.expandedDirectory
            ? theme.icons[badgeId]
            : undefined;
        const icon = theme.icons[id];
        const color = badge?.color ?? icon.color;
        return {
          id,
          src: icon.src,
          color: theme.palette[color] ?? color,
          ruleId: rule?.id,
          ...(badge && badgeId
            ? {
                badge: {
                  id: badgeId,
                  src: badge.src,
                  color: theme.palette[badge.color] ?? badge.color,
                },
              }
            : {}),
        };
      }
      const id = rule?.icon ?? theme.defaults.file;
      const icon = theme.icons[id];
      return {
        id,
        src: icon.src,
        color: theme.palette[icon.color] ?? icon.color,
        ruleId: rule?.id,
      };
    },
  };
}
