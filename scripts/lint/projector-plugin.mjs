/**
 * Project rules that are not FEOD structure and therefore live beside the lint config,
 * not in the architecture plugin: the same file is loaded by `vp lint`/`vp check` and by
 * `scripts/check-feod.mjs`, which runs the rules in the build and test gate.
 */

const ICON_PREFIX = "~icons/";

/** The only file allowed to import icon sets directly; the registry exports names from it. */
const ICON_REGISTRY = "packages/client/common/icons/sets.ts";

const pathOf = (context) => {
  const filename =
    typeof context.filename === "string" ? context.filename : context.getFilename?.();
  return typeof filename === "string" ? filename.replace(/\\/g, "/") : "";
};

const isIconImport = (value) => typeof value === "string" && value.startsWith(ICON_PREFIX);

const noDirectIconImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Icons come from the shared registry: import them by name through <ProjectorIcon>, never from ~icons directly",
    },
    schema: [],
    messages: {
      direct:
        "'{{source}}' bypasses the icon service. Add the icon to packages/client/common/icons/sets.ts and render it with <ProjectorIcon name=\"…\" />.",
    },
  },
  create(context) {
    if (pathOf(context).endsWith(ICON_REGISTRY)) return {};

    const report = (node, source) => {
      context.report({ node, messageId: "direct", data: { source } });
    };

    return {
      ImportDeclaration(node) {
        if (isIconImport(node.source?.value)) report(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (isIconImport(node.source?.value)) report(node.source, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (isIconImport(node.source?.value)) report(node.source, node.source.value);
      },
      ImportExpression(node) {
        if (isIconImport(node.source?.value)) report(node.source, node.source.value);
      },
    };
  },
};

export default {
  meta: { name: "projector", version: "1.0.0" },
  rules: { "no-direct-icon-import": noDirectIconImport },
};
