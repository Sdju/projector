import { defineComponent, h, type Component, type VNode } from "vue";

const SVG_ROOT = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i;
const VIEW_BOX = /\bviewBox\s*=\s*["']([^"']+)["']/i;
const SHAPE = /<(path|circle|rect|polygon|polyline|line)\b([^>]*)>/gi;
const ATTR = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;

function attrsOf(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.replace(/\/\s*$/, "").matchAll(ATTR)) attrs[match[1]!] = match[2]!;
  return attrs;
}

/** Turns sanitized plugin SVG markup into vnode children (Vue does not fill SVG via innerHTML). */
export function iconNodesFromSvg(svg: string): { viewBox: string; children: VNode[] } {
  const match = SVG_ROOT.exec(svg.trim());
  const inner = match?.[2] ?? "";
  const viewBox = VIEW_BOX.exec(match?.[1] ?? "")?.[1] ?? "0 0 24 24";
  const children: VNode[] = [];
  for (const item of inner.matchAll(SHAPE)) children.push(h(item[1]!, attrsOf(item[2] ?? "")));
  return { viewBox, children };
}

/** Turns sanitized plugin SVG into a Vue icon the + button and usage meter can mount. */
export function iconFromSvg(svg: string): Component {
  return defineComponent({
    name: "PluginAgentIcon",
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => {
        const { viewBox, children } = iconNodesFromSvg(svg);
        return h(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox,
            fill: "currentColor",
            width: "1em",
            height: "1em",
            "aria-hidden": "true",
            ...attrs,
          },
          children,
        );
      };
    },
  });
}
